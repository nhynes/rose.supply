import { time } from '@nomicfoundation/hardhat-network-helpers';
import { SignerWithAddress } from '@nomiclabs/hardhat-ethers/signers';
import { expect } from 'chai';
import { Wallet } from 'ethers';
import { ethers } from 'hardhat';

import { FaucetV1 } from '../typechain-types/contracts/FaucetV1';

const ONE_DAY_IN_SECS = 24 * 60 * 60;

describe('FaucetV1', () => {
  let owner: SignerWithAddress;
  let agent: SignerWithAddress;
  let recipients: Wallet[];

  let faucetByOwner: FaucetV1;
  let faucetByAgent: FaucetV1;

  beforeEach(async () => {
    [owner, agent] = await ethers.getSigners();
    const FaucetV1 = await ethers.getContractFactory('FaucetV1');
    faucetByOwner = await FaucetV1.deploy({
      value: ethers.utils.parseEther('10'),
    });
    faucetByAgent = faucetByOwner.connect(agent);
    await faucetByOwner.authorizeAgents([agent.address]);
    recipients = [];
    for (let i = 0; i < 5; i++) {
      recipients.push(ethers.Wallet.createRandom().connect(ethers.provider));
    }
  });

  it('donate', async () => {
    await expect(
      faucetByOwner.donate(Buffer.from('hello'), {
        value: ethers.utils.parseEther('2'),
      }),
    )
      .to.emit(faucetByOwner, 'Donation')
      .withArgs(owner.address, 2n * 10n ** 18n, '0x68656c6c6f');
  });

  it('payout unauthorized', async () => {
    await expect(faucetByOwner.payoutBatch([])).to.be.revertedWith('not agent');
  });

  it('add agent unauthorized', async () => {
    await expect(faucetByAgent.authorizeAgents([])).to.be.revertedWith(
      'not admin',
    );
  });

  it('payout', async () => {
    const payoutAmount = await faucetByAgent.callStatic._payout();
    const tx = await faucetByAgent.payoutBatch(
      recipients.map((r) => r.address),
    );
    await expect(tx).to.changeEtherBalance(
      faucetByAgent,
      ethers.BigNumber.from(recipients.length).mul(payoutAmount).mul(-1),
    );
    for (const recipient of recipients) {
      await expect(tx).to.changeEtherBalance(recipient, payoutAmount);
    }
  });

  it('payout cap', async () => {
    await faucetByOwner.adjustMaxDailyPayout(1);
    const payoutAmount = await faucetByAgent.callStatic._payout();
    const recipientAddrs = recipients.map((r) => r.address);
    await expect(
      await faucetByAgent.payoutBatch(recipientAddrs),
    ).to.changeEtherBalance(faucetByAgent, payoutAmount.mul(-1));
    await expect(faucetByAgent.payoutBatch(recipientAddrs)).to.be.revertedWith(
      'dry',
    );
    await time.increase(ONE_DAY_IN_SECS);
    await expect(
      await faucetByAgent.payoutBatch(recipientAddrs),
    ).to.changeEtherBalance(faucetByAgent, payoutAmount.mul(-1));
  });
});
