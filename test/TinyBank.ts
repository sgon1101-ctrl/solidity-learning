import hre from "hardhat";
import { expect } from "chai";
import { DECIMALS, MINTING_AMOUNT } from "./constant";
import { MyToken, TinyBank } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

describe("tinyBank", () => {
  let signers: HardhatEthersSigner[];
  let myTokenC: MyToken;
  let tinyBankC: TinyBank;
  beforeEach(async () => {
    signers = await hre.ethers.getSigners();
    myTokenC = await hre.ethers.deployContract("MyToken", [
      "MyToken",
      "MT",
      DECIMALS,
      MINTING_AMOUNT,
    ]);
    tinyBankC = await hre.ethers.deployContract("TinyBank", [
      await myTokenC.getAddress(),
    ]);
    await myTokenC.setManager(tinyBankC.getAddress());
    await tinyBankC.setManagers(signers.slice(0, 3).map((signer) => signer.address));
  });

  describe("Initialized state check", () => {
    it("should return totalStaked 0", async () => {
      expect(await tinyBankC.totalStaked()).equal(0);
    });
    it("should retirn staked 0 amount of signer0", async () => {
      const signer0 = signers[0];
      expect(await tinyBankC.staked(signer0.address)).equal(0);
    });
  });

  describe("Manager setup and withdrawals by another user", () => {
    it("should register the bank as token manager and keep the bank manager", async () => {
      expect(await myTokenC.manager()).equal(await tinyBankC.getAddress());
      expect(await tinyBankC.manager()).equal(signers[0].address);
      expect(await tinyBankC.rewardPerBlock()).equal(hre.ethers.parseUnits("1", DECIMALS));
      const reward = hre.ethers.parseUnits("2", DECIMALS);
      const data = tinyBankC.interface.encodeFunctionData("setRewardPerBlock", [reward]);
      for (const manager of signers.slice(0, 3)) {
        await tinyBankC.connect(manager).confirm(data);
      }
      await tinyBankC.setRewardPerBlock(reward);
      expect(await tinyBankC.rewardPerBlock()).equal(reward);
    });

    it("should pay another user's rewards and return principal on partial and full withdrawals", async () => {
      const user = signers[1];
      const amount = hre.ethers.parseUnits("20", DECIMALS);
      const partial = hre.ethers.parseUnits("7", DECIMALS);
      const bankAddress = await tinyBankC.getAddress();
      await myTokenC.transfer(amount, user.address);
      await myTokenC.connect(user).approve(bankAddress, amount);
      const ownerBalance = await myTokenC.balanceOf(signers[0].address);
      const initialSupply = await myTokenC.totalSupply();
      const stakeReceipt = await (await tinyBankC.connect(user).stake(amount)).wait();
      await hre.network.provider.send("hardhat_mine", ["0x5"]);
      const partialTx = await tinyBankC.connect(user).withdraw(partial);
      const partialReceipt = await partialTx.wait();
      const rewardPerBlock = await tinyBankC.rewardPerBlock();
      const firstReward = BigInt(partialReceipt!.blockNumber - stakeReceipt!.blockNumber) * rewardPerBlock;
      await expect(partialTx).to.emit(tinyBankC, "Withdraw").withArgs(partial, user.address);
      expect(await myTokenC.balanceOf(user.address)).equal(partial + firstReward);
      expect(await tinyBankC.staked(user.address)).equal(amount - partial);
      expect(await tinyBankC.totalStaked()).equal(amount - partial);
      expect(await myTokenC.balanceOf(bankAddress)).equal(amount - partial);
      expect(await tinyBankC.lastClaimedBlock(user.address)).equal(partialReceipt!.blockNumber);

      const fullReceipt = await (await tinyBankC.connect(user).withdraw(amount - partial)).wait();
      const totalReward = BigInt(fullReceipt!.blockNumber - stakeReceipt!.blockNumber) * rewardPerBlock;
      expect(await myTokenC.balanceOf(user.address)).equal(amount + totalReward);
      expect(await myTokenC.balanceOf(signers[0].address)).equal(ownerBalance);
      expect(await myTokenC.totalSupply()).equal(initialSupply + totalReward);
      expect(await tinyBankC.staked(user.address)).equal(0n);
      expect(await tinyBankC.totalStaked()).equal(0n);
      expect(await myTokenC.balanceOf(bankAddress)).equal(0n);
    });

    it("should revert an excessive withdrawal without changing balances or stake", async () => {
      const amount = hre.ethers.parseUnits("10", DECIMALS);
      const bankAddress = await tinyBankC.getAddress();
      await myTokenC.approve(bankAddress, amount);
      await tinyBankC.stake(amount);
      const balance = await myTokenC.balanceOf(signers[0].address);
      const supply = await myTokenC.totalSupply();
      const lastClaimed = await tinyBankC.lastClaimedBlock(signers[0].address);
      await expect(tinyBankC.withdraw(amount + 1n)).to.be.revertedWith("insufficient staked token");
      expect(await myTokenC.balanceOf(signers[0].address)).equal(balance);
      expect(await myTokenC.totalSupply()).equal(supply);
      expect(await tinyBankC.lastClaimedBlock(signers[0].address)).equal(lastClaimed);
      expect(await tinyBankC.staked(signers[0].address)).equal(amount);
      expect(await tinyBankC.totalStaked()).equal(amount);
      expect(await myTokenC.balanceOf(bankAddress)).equal(amount);
    });
  });

  describe("All managers must confirm", () => {
    const reward = hre.ethers.parseUnits("2", DECIMALS);

    function rewardData(amount = reward) {
      return tinyBankC.interface.encodeFunctionData("setRewardPerBlock", [amount]);
    }

    async function confirmAll(amount = reward) {
      for (const manager of signers.slice(0, 3)) {
        await tinyBankC.connect(manager).confirm(rewardData(amount));
      }
    }

    it("should register three distinct managers", async () => {
      for (let i = 0; i < 3; i++) {
        expect(await tinyBankC.managers(i)).equal(signers[i].address);
        expect(await tinyBankC.isManager(signers[i].address)).equal(true);
      }
      expect(await tinyBankC.isManager(signers[3].address)).equal(false);
    });

    it("should reject manager registration by anyone except the owner", async () => {
      await expect(tinyBankC.connect(signers[1]).setManagers(
        signers.slice(1, 4).map((signer) => signer.address),
      )).to.be.revertedWith("You are not authorized");
    });

    it("should reject fewer than three managers, duplicates and zero addresses", async () => {
      const round = await tinyBankC.confirmationRound();
      await expect(tinyBankC.setManagers([signers[0].address, signers[1].address]))
        .to.be.revertedWith("At least 3 managers required");
      await expect(tinyBankC.setManagers([
        signers[0].address, signers[1].address, signers[1].address,
      ])).to.be.revertedWith("Duplicate manager");
      await expect(tinyBankC.setManagers([
        signers[0].address, signers[1].address, hre.ethers.ZeroAddress,
      ])).to.be.revertedWith("Invalid manager");
      expect(await tinyBankC.confirmationRound()).equal(round);
      expect(await tinyBankC.isManager(signers[2].address)).equal(true);
      expect(await tinyBankC.managers(2)).equal(signers[2].address);
    });

    it("should reject confirmations from a non-manager", async () => {
      await expect(tinyBankC.connect(signers[3]).confirm(rewardData()))
        .to.be.revertedWith("You are not a manager");
    });

    it("should reject execution with zero or only two confirmations", async () => {
      const initialReward = await tinyBankC.rewardPerBlock();
      await expect(tinyBankC.setRewardPerBlock(reward))
        .to.be.revertedWith("Not all confirmed yet");
      await tinyBankC.connect(signers[0]).confirm(rewardData());
      await tinyBankC.connect(signers[1]).confirm(rewardData());
      await expect(tinyBankC.setRewardPerBlock(reward))
        .to.be.revertedWith("Not all confirmed yet");
      expect(await tinyBankC.rewardPerBlock()).equal(initialReward);
    });

    it("should not count repeated confirmations as different managers", async () => {
      for (let i = 0; i < 3; i++) {
        await tinyBankC.confirm(rewardData());
      }
      await expect(tinyBankC.setRewardPerBlock(reward))
        .to.be.revertedWith("Not all confirmed yet");
    });

    it("should allow a registered manager to execute after everyone confirms", async () => {
      await confirmAll();
      await tinyBankC.connect(signers[2]).setRewardPerBlock(reward);
      expect(await tinyBankC.rewardPerBlock()).equal(reward);
    });

    it("should reject a non-manager even after everyone confirms", async () => {
      await confirmAll();
      await expect(tinyBankC.connect(signers[3]).setRewardPerBlock(reward))
        .to.be.revertedWith("You are not a manager");
      await tinyBankC.setRewardPerBlock(reward);
      expect(await tinyBankC.rewardPerBlock()).equal(reward);
    });

    it("should require confirmation for the exact reward amount", async () => {
      await confirmAll();
      await expect(tinyBankC.setRewardPerBlock(reward + 1n))
        .to.be.revertedWith("Not all confirmed yet");
      await tinyBankC.setRewardPerBlock(reward);
      expect(await tinyBankC.rewardPerBlock()).equal(reward);
    });

    it("should require fresh confirmations after execution", async () => {
      await confirmAll();
      await tinyBankC.setRewardPerBlock(reward);
      await expect(tinyBankC.setRewardPerBlock(reward))
        .to.be.revertedWith("Not all confirmed yet");
      await confirmAll();
      await tinyBankC.setRewardPerBlock(reward);
      expect(await tinyBankC.rewardPerBlock()).equal(reward);
    });

    it("should invalidate old confirmations when managers change", async () => {
      await confirmAll();
      await tinyBankC.setManagers(signers.slice(1, 4).map((signer) => signer.address));
      expect(await tinyBankC.isManager(signers[0].address)).equal(false);
      await expect(tinyBankC.confirm(rewardData()))
        .to.be.revertedWith("You are not a manager");
      await expect(tinyBankC.connect(signers[1]).setRewardPerBlock(reward))
        .to.be.revertedWith("Not all confirmed yet");
      for (const manager of signers.slice(1, 4)) {
        await tinyBankC.connect(manager).confirm(rewardData());
      }
      await tinyBankC.connect(signers[1]).setRewardPerBlock(reward);
      expect(await tinyBankC.rewardPerBlock()).equal(reward);
    });

    it("should require all four confirmations when four managers are registered", async () => {
      await tinyBankC.setManagers(signers.slice(0, 4).map((signer) => signer.address));
      await confirmAll();
      await expect(tinyBankC.setRewardPerBlock(reward))
        .to.be.revertedWith("Not all confirmed yet");
      await tinyBankC.connect(signers[3]).confirm(rewardData());
      await tinyBankC.setRewardPerBlock(reward);
      expect(await tinyBankC.rewardPerBlock()).equal(reward);
    });
  });

  describe("Staking", async () => {
    it("should return staked amount", async () => {
      const signer0 = signers[0];
      const stakingAmount = hre.ethers.parseUnits("50", DECIMALS);
      await myTokenC.approve(await tinyBankC.getAddress(), stakingAmount);
      await tinyBankC.stake(stakingAmount);
      expect(await tinyBankC.staked(signer0.address)).equal(stakingAmount);
      expect(await tinyBankC.totalStaked()).equal(stakingAmount);
      expect(await myTokenC.balanceOf(tinyBankC)).equal(
        await tinyBankC.totalStaked(),
      );
    });
  });

  describe("Withdraw", () => {
    it("should return 0 staked after withdrawing total token", async () => {
      const signer0 = signers[0];
      const stakingAmount = hre.ethers.parseUnits("50", DECIMALS);
      await myTokenC.approve(await tinyBankC.getAddress(), stakingAmount);
      await tinyBankC.stake(stakingAmount);
      await tinyBankC.withdraw(stakingAmount);
      expect(await tinyBankC.staked(signer0.address)).equal(0);
    });
  });
  describe("reward", () => {
    it("should reward 1MT every blocks", async () => {
      const signer0 = signers[0];
      const stakingAmount = hre.ethers.parseUnits("50", DECIMALS);
      await myTokenC.approve(tinyBankC.getAddress(), stakingAmount);
      await tinyBankC.stake(stakingAmount);

      const BLOCKS = 5n;
      const transferAmount = hre.ethers.parseUnits("1", DECIMALS);
      for (var i = 0; i < 5; i++) {
        await myTokenC.transfer(transferAmount, signer0.address);
      }
      await tinyBankC.withdraw(stakingAmount);
      expect(await myTokenC.balanceOf(signer0.address)).equal(
        hre.ethers.parseUnits((BLOCKS + MINTING_AMOUNT + 1n).toString()),
      );
    });
    it("Should revert when changing rewarPerBlock by hacker", async () => {
      const hacker = signers[3];
      const rewardToChange = hre.ethers.parseUnits("10000", DECIMALS);
      await expect(
        tinyBankC.connect(hacker).setRewardPerBlock(rewardToChange),
      ).to.be.revertedWith("You are not a manager");
    });
  });
});
