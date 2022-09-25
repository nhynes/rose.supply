import * as sapphire from '@oasisprotocol/sapphire-paratime';
import cors from 'cors';
import { CronJob } from 'cron';
import { ethers } from 'ethers';
import express, { Request, Response } from 'express';
import * as hcaptcha from 'hcaptcha';

import { FaucetV1, FaucetV1__factory } from 'rose-supply-contracts';

const HCAPTCHA_SITEKEY = 'fd74b3a8-7fac-467f-be40-5c525e79ac83';

class Agent {
  private nextTimeout: NodeJS.Timeout | undefined;
  private readonly requests = new Map<string, string | undefined>();

  private readonly fundedToday = new Set<string>();
  private readonly accessedToday = new Set<string>();

  constructor(private readonly faucet: FaucetV1) {
    new CronJob(
      '0 0 * * *',
      () => {
        this.fundedToday.clear();
        this.accessedToday.clear();
      },
      undefined,
      true,
      undefined,
      undefined,
      false,
      undefined,
      true, // unrefTimeout
    );
  }

  public mayRequest(requester: string | undefined, recipient: string): boolean {
    return !(
      this.requests.has(recipient) ||
      this.fundedToday.has(recipient) ||
      (requester !== undefined && this.accessedToday.has(requester))
    );
  }

  public addRequest(requester: string | undefined, recipient: string) {
    this.requests.set(recipient, requester ?? '');
    if (!this.nextTimeout) {
      this.nextTimeout = setTimeout(() => this.payoutBatch(), 20_000);
    }
  }

  private async payoutBatch(): Promise<void> {
    try {
      const tx = await this.faucet.payoutBatch([...this.requests.keys()]);
      console.log('funding', this.requests.size, 'addresses in', tx.hash);
    } catch (e: any) {
      console.error('failed to post funding tx:', e);
    }
    for (const [recipient, requester] of this.requests) {
      if (requester) this.accessedToday.add(requester);
      this.fundedToday.add(recipient);
    }
    this.requests.clear();
    this.nextTimeout = undefined;
  }
}

const hcaptchaSecret = process.env.HCAPTCHA_SECRET;
if (!hcaptchaSecret) throw new Error('HCAPTCHA_SECRET not set');
const faucetAddr =
  process.env.FAUCET_ADDR ?? '0xd5D44cFdB2040eC9135930Ca75d9707717cafB92';
const gwUrl = process.env.WEB3_GW_URL ?? 'https://testnet.sapphire.oasis.dev';
const privateKey = process.env.AGENT_PRIVATE_KEY;
if (!privateKey) throw new Error('AGENT_PRIVATE_KEY not set');
const provider = ethers.getDefaultProvider(gwUrl);
const wallet = new ethers.Wallet(privateKey);
console.log('posting txs as', wallet.address);
const signer = sapphire.wrap(wallet.connect(provider));
const faucet = FaucetV1__factory.connect(faucetAddr, signer);
const agent = new Agent(faucet);

const app = express();

app.use(
  cors({
    origin: 'rose.supply',
    methods: 'POST',
    allowedHeaders: ['content-type'],
    maxAge: 30 * 24 * 60 * 60,
  }),
);
app.use(express.json());

function err(res: Response, status: number, msg: string) {
  res.status(status).json({ error: msg }).end();
}

app.post('/request', async (req, res) => {
  const cfIp = req.headers['cf-connecting-ip'] as string;
  const { token, address } = req.body;
  try {
    const { success } = await hcaptcha.verify(
      hcaptchaSecret,
      token,
      cfIp,
      HCAPTCHA_SITEKEY,
    );
    if (!success) throw new Error('hcaptcha failed');
  } catch (e: any) {
    return err(res, 401, 'hcaptcha failed');
  }
  if (typeof address !== 'string' || !ethers.utils.isAddress(address)) {
    return err(res, 400, 'missing or invalid `address`');
  }
  if (!agent.mayRequest(cfIp, address)) return err(res, 429, 'already funded');
  try {
    const [code, balance] = await Promise.all([
      provider.getCode(address),
      provider.getBalance(address),
    ]);
    if (code !== '0x' && code !== '')
      return err(res, 400, 'recipient may not be a contract');
    if (balance >= ethers.utils.parseEther('.01'))
      return err(res, 400, 'recipient is too rich');
  } catch (e) {
    console.error('failed to check recipient', e);
    return err(res, 500, 'internal server error');
  }
  agent.addRequest(cfIp, address);
  res.status(204).end();
});

app.use((e: unknown, _req: Request, res: Response) => {
  console.error(e);
  return err(res, 500, 'internal server error');
});

app.listen(80);
