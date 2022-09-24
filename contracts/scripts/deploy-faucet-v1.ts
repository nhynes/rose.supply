import * as sapphire from '@oasisprotocol/sapphire-paratime';
import { ethers } from 'hardhat';

async function main() {
  const funding = ethers.utils.parseEther('10');
  const signer = sapphire.wrap((await ethers.getSigners())[0]);
  const FaucetV1 = await ethers.getContractFactory('FaucetV1', signer);
  const faucetv1 = await FaucetV1.deploy({ value: funding });
  await faucetv1.deployed();
  console.log(`FaucetV1 deployed to ${faucetv1.address}`);
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
