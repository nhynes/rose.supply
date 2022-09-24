import * as sapphire from '@oasisprotocol/sapphire-paratime';
import { ethers } from 'ethers';
import cors from 'cors';
import express, { Request, Response } from 'express';

import { FaucetV1__factory } from 'rose-supply-contracts';

const POLL_INTERVAL_MS = 20_000;

const app = express();

const gwUrl = process.env.WEB3_GW_URL ?? 'https://testnet.sapphire.oasis.dev';
const provider = ethers.getDefaultProvider(gwUrl);

const requests = new Set<string>();

function startWorker() {
  const privateKey = process.env.AGENT_PRIVATE_KEY;
  if (!privateKey) throw new Error('AGENT_PRIVATE_KEY not set');
  const wallet = new ethers.Wallet(privateKey);
  console.log('posting txs as', wallet.address);
  const faucetAddr =
    process.env.FAUCET_ADDR ?? '0xd5D44cFdB2040eC9135930Ca75d9707717cafB92';

  const signer = sapphire.wrap(wallet.connect(provider));
  const faucet = FaucetV1__factory.connect(faucetAddr, signer);

  async function payoutBatch() {
    if (requests.size == 0) return;
    try {
      const tx = await faucet.payoutBatch([...requests]);
      console.log('funding', requests.size, 'addresses in', tx.hash);
    } catch (e: any) {
      console.error('failed to post funding tx:', e);
    }
    requests.clear();
    setTimeout(payoutBatch, POLL_INTERVAL_MS);
  }
  setTimeout(payoutBatch, POLL_INTERVAL_MS);
}

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
  const { address } = req.body;
  if (!address || !/^(0x)?[a-f0-9]{40,40}$/i.test(address)) {
    return err(res, 400, 'missing or invalid `address`');
  }
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
    console.error('failed to check recipient');
    return err(res, 500, 'internal server error');
  }
  requests.add(address);
  res.status(204).end();
});

app.use((e: unknown, _req: Request, res: Response) => {
  console.error(e);
  return err(res, 500, 'internal server error');
});

startWorker();

app.listen(80);
