// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {PodVault} from "../src/PodVault.sol";
import {DrawdownGuard} from "../src/DrawdownGuard.sol";
import {ReasoningLogger} from "../src/ReasoningLogger.sol";
import {MockUSDC} from "./MockUSDC.sol";

contract PodVaultTest is Test {
    PodVault vault;
    DrawdownGuard guard;
    ReasoningLogger logger;
    MockUSDC usdc;

    address owner = address(0xA1);
    address rebalancer = address(0xB1);
    address alice = address(0xC1);
    address bob = address(0xC2);

    function setUp() public {
        usdc = new MockUSDC();

        vm.prank(owner);
        guard = new DrawdownGuard(owner);
        vm.prank(owner);
        logger = new ReasoningLogger(owner);

        vm.prank(owner);
        vault = new PodVault(
            usdc,
            guard,
            logger,
            owner,
            rebalancer,
            1, // BALANCED
            1000, // 10% drawdown cap
            "POD Balanced Vault",
            "podBAL"
        );

        // Authorise the vault to write to the logger.
        vm.prank(owner);
        logger.grantRole(address(vault), 1);

        // Authorise the rebalancer as a guard oracle (so updateNav succeeds when called via vault).
        vm.prank(owner);
        guard.setOracle(address(vault), true);

        // Fund users.
        usdc.mint(alice, 10_000e6);
        usdc.mint(bob, 10_000e6);

        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);
    }

    function test_first_deposit_mints_1to1() public {
        vm.prank(alice);
        uint256 shares = vault.deposit(1000e6);
        assertEq(shares, 1000e6);
        assertEq(vault.balanceOf(alice), 1000e6);
        assertEq(vault.totalSupply(), 1000e6);
        assertEq(vault.lastNav(), 1000e6);
    }

    function test_second_deposit_mints_proportionally() public {
        vm.prank(alice);
        vault.deposit(1000e6);

        vm.prank(bob);
        uint256 bobShares = vault.deposit(500e6);
        // bob gets 500/1000 * 1000e6 = 500e6 shares
        assertEq(bobShares, 500e6);
        assertEq(vault.totalSupply(), 1500e6);
    }

    function test_withdraw_returns_proportional_usdc() public {
        vm.prank(alice);
        vault.deposit(1000e6);
        uint256 balBefore = usdc.balanceOf(alice);

        vm.prank(alice);
        uint256 returned = vault.withdraw(500e6);
        assertEq(returned, 500e6);
        assertEq(usdc.balanceOf(alice) - balBefore, 500e6);
        assertEq(vault.balanceOf(alice), 500e6);
    }

    function test_apply_rebalance_logs_reasoning() public {
        vm.prank(alice);
        vault.deposit(1000e6);

        bytes32[] memory citations = new bytes32[](1);
        citations[0] = keccak256("ETF_FLOW");

        vm.prank(rebalancer);
        uint256 id = vault.applyRebalance(
            1100e6, // NAV grew to $1100
            keccak256("reason"),
            "QmAbc",
            int256(1_500_000),
            85,
            citations
        );

        assertEq(id, 0);
        assertEq(vault.lastNav(), 1100e6);
        assertEq(logger.totalEntries(), 1);
    }

    function test_apply_rebalance_blocked_when_drawdown_tripped() public {
        vm.prank(alice);
        vault.deposit(1000e6);

        // First push HWM to 1000 by initial deposit + small gain.
        bytes32[] memory citations = new bytes32[](0);

        vm.prank(rebalancer);
        vault.applyRebalance(1100e6, bytes32(0), "", 0, 70, citations);

        // Now NAV drops 11% from HWM (1100 → 979) -> trips 10% guard.
        vm.prank(rebalancer);
        vm.expectRevert(PodVault.DrawdownTripped.selector);
        vault.applyRebalance(979e6, bytes32(0), "", 0, 30, citations);
    }

    function test_only_rebalancer_can_apply() public {
        bytes32[] memory citations = new bytes32[](0);
        vm.prank(alice);
        vm.expectRevert(PodVault.NotRebalancer.selector);
        vault.applyRebalance(1100e6, bytes32(0), "", 0, 50, citations);
    }

    function test_pause_blocks_rebalance_but_not_withdraw() public {
        vm.prank(alice);
        vault.deposit(1000e6);

        vm.prank(owner);
        vault.setPaused(true);

        bytes32[] memory citations = new bytes32[](0);
        vm.prank(rebalancer);
        vm.expectRevert(PodVault.PausedError.selector);
        vault.applyRebalance(1100e6, bytes32(0), "", 0, 50, citations);

        // But user can still withdraw
        vm.prank(alice);
        uint256 returned = vault.withdraw(500e6);
        assertEq(returned, 500e6);
    }

    function test_set_rebalancer_only_owner() public {
        vm.prank(alice);
        vm.expectRevert(PodVault.NotOwner.selector);
        vault.setRebalancer(address(0xDEAD));

        vm.prank(owner);
        vault.setRebalancer(address(0xDEAD));
        assertEq(vault.rebalancer(), address(0xDEAD));
    }

    function test_zero_deposit_reverts() public {
        vm.prank(alice);
        vm.expectRevert(PodVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_insufficient_shares_reverts() public {
        vm.prank(alice);
        vault.deposit(100e6);
        vm.prank(alice);
        vm.expectRevert(PodVault.InsufficientShares.selector);
        vault.withdraw(200e6);
    }

    function test_price_per_share() public {
        // Empty vault → 1.0
        assertEq(vault.pricePerShare(), 1e18);

        vm.prank(alice);
        vault.deposit(1000e6);
        assertEq(vault.pricePerShare(), 1e18); // 1:1

        // After NAV update to 1.1x
        bytes32[] memory citations = new bytes32[](0);
        vm.prank(rebalancer);
        vault.applyRebalance(1100e6, bytes32(0), "", 0, 50, citations);

        // 1100e6 * 1e18 / 1000e6 = 1.1e18
        assertEq(vault.pricePerShare(), 1.1e18);
    }
}
