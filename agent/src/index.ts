import * as sapphire from '@oasisprotocol/sapphire-paratime';
import cors from 'cors';
import { CronJob } from 'cron';
import { ethers } from 'ethers';
import express, { Request, Response } from 'express';
import * as hcaptcha from 'hcaptcha';

import { FaucetV1, FaucetV1__factory } from 'rose-supply-contracts';

const HCAPTCHA_SITEKEY = 'fd74b3a8-7fac-467f-be40-5c525e79ac83';

const fundedToday = new Set<string>(); // wallet address
const accessedToday = new Set<string>(); // ip address

new CronJob(
  '0 0 * * *',
  () => {
    fundedToday.clear();
    accessedToday.clear();
  },
  undefined,
  true,
  undefined,
  undefined,
  false,
  undefined,
  true, // unrefTimeout to not keep event loop going
);

class Agent {
  private nextTimeout: NodeJS.Timeout | undefined;
  private readonly requests = new Map<string, string | undefined>();

  private readonly faucet: FaucetV1;

  constructor(faucetAddr: string, signer: ethers.Signer) {
    if (!signer.provider) throw new Error('not connected');
    this.faucet = FaucetV1__factory.connect(faucetAddr, signer);
  }

  public get provider(): ethers.providers.Provider {
    return this.faucet.signer.provider!;
  }

  public hasPendingRequest(recipient: string): boolean {
    return this.requests.has(recipient);
  }

  public addRequest(requester: string | undefined, recipient: string) {
    this.requests.set(recipient, requester ?? '');
    if (!this.nextTimeout) {
      this.nextTimeout = setTimeout(() => this.payoutBatch(), 60_000);
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
      if (requester) accessedToday.add(requester);
      fundedToday.add(recipient);
    }
    this.requests.clear();
    this.nextTimeout = undefined;
  }
}

const hcaptchaSecret = process.env.HCAPTCHA_SECRET;
if (!hcaptchaSecret) throw new Error('HCAPTCHA_SECRET not set');
const privateKey = process.env.AGENT_PRIVATE_KEY;
if (!privateKey) throw new Error('AGENT_PRIVATE_KEY not set');
const wallet = new ethers.Wallet(privateKey);
console.log('posting txs as', wallet.address);

const agents = {
  emerald: new Agent(
    '0xA3ACe1150C4A437c6641B9d353123B3d513264b7',
    wallet.connect(ethers.getDefaultProvider('https://emerald.oasis.dev')),
  ),
  sapphire: new Agent(
    '0xd5D44cFdB2040eC9135930Ca75d9707717cafB92',
    sapphire.wrap(
      wallet.connect(
        ethers.getDefaultProvider('https://testnet.sapphire.oasis.dev'),
      ),
    ),
  ),
};

const app = express();

app.use(
  cors({
    origin: 'https://rose.supply',
    methods: 'POST',
    allowedHeaders: ['content-type'],
    maxAge: 30 * 24 * 60 * 60,
  }),
);
app.use(express.json());

function respondError(
  res: Response,
  status: number,
  msg: string,
  next?: (err?: any) => void,
) {
  try {
    res.status(status).json({ error: msg }).end();
  } catch (e: any) {
    if (next) next(e);
  }
}

app.get('/request', (_req, res) => {
  respondError(res, 405, 'method not allowed');
});

app.post('/request', async (req, res, next) => {
  const err = (code: number, msg: string) => respondError(res, code, msg, next);

  const { token, address, network } = req.body;

  if (
    typeof network !== 'string' ||
    (network !== 'emerald' && network !== 'sapphire')
  ) {
    return err(400, 'invalid `network`');
  }

  if (!token) return err(400, 'missing `token`');

  if (typeof address !== 'string' || !ethers.utils.isAddress(address))
    return err(400, 'missing or invalid `address`');

  const cfIp = req.headers['cf-connecting-ip'] as string;
  if (fundedToday.has(address) || (cfIp && accessedToday.has(cfIp)))
    return err(429, 'you have already been funded');

  try {
    const { success } = await hcaptcha.verify(
      hcaptchaSecret,
      token,
      cfIp,
      HCAPTCHA_SITEKEY,
    );
    if (!success) throw new Error('unsuccessful');
  } catch (e: any) {
    return err(401, 'hCaptcha failed');
  }

  const agent = agents[network];

  if (agent.hasPendingRequest(address))
    return err(429, 'funding still in progress');

  try {
    const [code, balance] = await Promise.all([
      agent.provider.getCode(address),
      agent.provider.getBalance(address),
    ]);
    if (code !== '0x' && code !== '')
      return err(400, 'the recipient may not be a contract');
    if (balance >= ethers.utils.parseEther('.01'))
      return err(400, 'the recipient is too rich');
  } catch (e) {
    console.error('failed to check recipient', e);
    return err(502, 'bad gateway');
  }
  agent.addRequest(cfIp, address);
  try {
    res.status(204).end();
  } catch (e: any) {
    next(e);
  }
});

app.get('*', (_req, res) => respondError(res, 404, 'not found'));
app.post('*', (_req, res) => respondError(res, 404, 'not found'));
app.head('*', (_req, res) => respondError(res, 405, 'bad method'));
app.put('*', (_req, res) => respondError(res, 405, 'bad method'));
app.delete('*', (_req, res) => respondError(res, 405, 'bad method'));

app.use((e: any, _req: Request, res: Response) => {
  console.error('uncaught error:', e);
  respondError(res, 500, 'internal server error');
});

app.listen(80);
