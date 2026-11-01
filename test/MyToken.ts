
import hre from "hardhat";
import { expect } from "chai";
import { MyToken, MyToken__factory } from "../typechain-types";
import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";

const MINTING_AMOUNT = 100n;
const DECIMALS = 18n;

describe("My Token", () => {
  let myTokenC: MyToken;
  let signers: HardhatEthersSigner[];
  beforeEach("should deploy", async () => {
    signers = await hre.ethers.getSigners();
    myTokenC = await hre.ethers.deployContract("MyToken", [
      "MyToken",
      "MT",
      DECIMALS,
      MINTING_AMOUNT,
    ]);
  });
  describe("Basic state value check", () => {
    it("shoud return name ", async () => {
      expect(await myTokenC.name()).equal("MyToken");
    });
    it("shoud return symbol ", async () => {
      expect(await myTokenC.symbol()).equal("MT");
    });
    it("shoud return decimals ", async () => {
      expect(await myTokenC.decimals()).equal(DECIMALS);
    });
    it("should return 100 totalSupply", async () => {
      expect(await myTokenC.totalSupply()).equal(
        MINTING_AMOUNT * 10n ** DECIMALS,
      );
    });
    //  expect(await myTokenC.name()).equal("MyToken");
    // expect(await myTokenC.symbol()).equal("MT");
    // expect(await myTokenC.decimals()).equal(18);
  });
  describe("Mint", () => {
    it("should return 1MT balance for signer 0", async () => {
      const signer0 = signers[0];
      expect(await myTokenC.balanceOf(signer0)).equal(
        MINTING_AMOUNT * 10n ** DECIMALS,
      );
    });
  });
  describe("Transfer", () => {
    it("should have 0.5MT", async () => {
      const signer0 = signers[0];
      const signer1 = signers[1];
      await expect(
        myTokenC.transfer(hre.ethers.parseUnits("0.5", 18), signer1.address),
      )
        .to.emit(myTokenC, "Transfer")
        .withArgs(
          signer0.address,
          signer1.address,
          hre.ethers.parseUnits("0.5", DECIMALS),
        );
      expect(await myTokenC.balanceOf(signer1.address)).equal(
        hre.ethers.parseUnits("0.5", DECIMALS),
      );
    });
    it("should be reverted with insufficient balance error", async () => {
      const signer1 = signers[1];
      await expect(
        myTokenC.transfer(
          hre.ethers.parseUnits((MINTING_AMOUNT + 1n).toString(), DECIMALS),
          signer1.address,
        ),
      ).to.be.revertedWith("insufficient balance");
    });
  });
  describe("TransferFrom", () => {
    it("should emit Approval event", async () => {
      const signer1 = signers[1];
      await expect(
        myTokenC.approval(
          signer1.address,
          hre.ethers.parseUnits("10", DECIMALS),
        ),
      )
        .to.emit(myTokenC, "Approval")
        .withArgs(signer1.address, hre.ethers.parseUnits("10", DECIMALS));
    });
    it("should be reverted with insufficient allowance error", async () => {
      const signer0 = signers[0];
      const signer1 = signers[1];
      await expect(
        myTokenC
          .connect(signer1)
          .transferFrom(
            signer0.address,
            signer1.address,
            hre.ethers.parseUnits("1", DECIMALS),
          ),
      ).to.be.revertedWith("insufficient allowance");
    });
    describe("TransferFrom", () => {
      it("should transfer token using allowance", async () => {
        const signer0 = signers[0];
        const signer1 = signers[1];

        // signer0이 signer1에게 권한 부여
        await myTokenC.approval(
          signer1.address,
          hre.ethers.parseUnits("10", DECIMALS),
        );

        // signer0 -> signer1 10MT 이동
        await myTokenC
          .connect(signer1)
          .transferFrom(
            signer0.address,
            signer1.address,
            hre.ethers.parseUnits("10", DECIMALS),
          );

        // signer1의 잔고 확인
        expect(await myTokenC.balanceOf(signer1.address)).equal(
          hre.ethers.parseUnits("10", DECIMALS),
        );
        // signer0의 잔고 확인
        expect(await myTokenC.balanceOf(signer0.address)).equal(
          hre.ethers.parseUnits("90", DECIMALS),
        );
      });
    });
  });

  //expect(await myTokenC.balanceOf(signer1.address)).equal(
  // hre.ethers.parseUnits("0.5", 18),
  //);
});
