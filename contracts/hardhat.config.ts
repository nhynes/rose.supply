import { promises as fs } from 'fs';
import path from 'path';

import * as sapphire from '@oasisprotocol/sapphire-paratime';
import { Signer } from 'ethers';
import { HardhatUserConfig, task, types } from 'hardhat/config';
import { TASK_COMPILE } from 'hardhat/builtin-tasks/task-names';

import canonicalize from 'canonicalize';

import '@nomiclabs/hardhat-ethers';
import '@nomiclabs/hardhat-waffle';
import '@typechain/hardhat';
import 'hardhat-watcher';

const TASK_EXPORT_ABIS = 'export-abis';
const TASK_ADD_AGENT = 'add-agent';

task(TASK_COMPILE, async (_args, hre, runSuper) => {
  await runSuper();
  await hre.run(TASK_EXPORT_ABIS);
});

task(TASK_EXPORT_ABIS, async (_args, hre) => {
  const srcDir = path.basename(hre.config.paths.sources);
  const outDir = path.join(hre.config.paths.root, 'abis');

  const [artifactNames] = await Promise.all([
    hre.artifacts.getAllFullyQualifiedNames(),
    fs.mkdir(outDir, { recursive: true }),
  ]);

  await Promise.all(
    artifactNames.map(async (fqn) => {
      const { abi, contractName, sourceName } =
        await hre.artifacts.readArtifact(fqn);
      if (
        abi.length === 0 ||
        !sourceName.startsWith(srcDir) ||
        contractName.endsWith('Test')
      )
        return;
      await fs.writeFile(
        `${path.join(outDir, contractName)}.json`,
        `${canonicalize(abi)}\n`,
      );
    }),
  );
});

async function getSigner(): Promise<Signer> {
  const { ethers } = await import('hardhat');
  const signers = await ethers.getSigners();
  return sapphire.wrap(signers[0]);
}

task(TASK_ADD_AGENT, 'Authorizes a new agent.')
  .addParam('faucetAddr', 'The Faucet address.', undefined, types.string)
  .addParam('agentAddr', 'The agent address.', undefined, types.string)
  .setAction(async (args) => {
    const { ethers } = await import('hardhat');
    const signer = await getSigner();
    const FaucetV1 = await ethers.getContractFactory('FaucetV1', signer);
    const faucet = FaucetV1.connect(signer).attach(args.faucetAddr);
    const tx = await faucet.authorizeAgents([args.agentAddr]);
    console.log(tx.hash);
    await tx.wait();
  });

const privateKey = process.env.PRIVATE_KEY ? [process.env.PRIVATE_KEY] : [];

const config: HardhatUserConfig = {
  solidity: {
    version: '0.8.17',
    settings: {
      optimizer: {
        enabled: true,
        runs: (1 << 32) - 1,
      },
      viaIR: true,
    },
  },
  networks: {
    'emerald-testnet': {
      url: 'https://testnet.emerald.oasis.dev',
      chainId: 0x0a515,
      accounts: privateKey,
    },
    'emerald-mainnet': {
      url: 'https://emerald.oasis.dev',
      chainId: 0xa516,
      accounts: privateKey,
    },
    'sapphire-testnet': {
      url: 'https://testnet.sapphire.oasis.dev',
      chainId: 0x5aff,
      accounts: privateKey,
    },
    'sapphire-mainnet': {
      url: 'https://sapphire.oasis.io',
      chainId: 0x5afe,
      accounts: privateKey,
    },
  },
  watcher: {
    compile: {
      tasks: ['compile'],
      files: ['./contracts/'],
    },
    test: {
      tasks: ['test'],
      files: ['./contracts/', './test'],
    },
    coverage: {
      tasks: ['coverage'],
      files: ['./contracts/', './test'],
    },
  },
};

export default config;
