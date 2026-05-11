// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {ReasoningLogger} from "../src/ReasoningLogger.sol";

contract ReasoningLoggerTest is Test {
    ReasoningLogger logger;
    address admin = address(0xA1);
    address vault = address(0xB1);
    address bot = address(0xC1);

    function setUp() public {
        vm.prank(admin);
        logger = new ReasoningLogger(admin);
    }

    function test_admin_has_logger_and_admin_roles() public view {
        assertEq(logger.roles(admin), 3); // 1 | 2
    }

    function test_grant_role_only_admin() public {
        vm.prank(bot);
        vm.expectRevert(ReasoningLogger.NotAuthorized.selector);
        logger.grantRole(bot, 1);

        vm.prank(admin);
        logger.grantRole(bot, 1);
        assertEq(logger.roles(bot), 1);
    }

    function test_log_reasoning_emits_event_and_persists() public {
        vm.prank(admin);
        logger.grantRole(bot, 1);

        bytes32[] memory citations = new bytes32[](2);
        citations[0] = keccak256("ETF_FLOW");
        citations[1] = keccak256("MACRO_EVENT");

        vm.prank(bot);
        uint256 id = logger.logReasoning(
            vault,
            keccak256("reasoning-v1"),
            "QmTestCid",
            int256(1_500_000),
            85,
            citations
        );

        assertEq(id, 0);
        assertEq(logger.totalEntries(), 1);

        ReasoningLogger.Entry memory e = logger.getEntry(0);
        assertEq(e.id, 0);
        assertEq(e.vault, vault);
        assertEq(e.actor, bot);
        assertEq(e.podScore, 85);
        assertEq(e.compositeZ, 1_500_000);
        assertEq(e.ipfsCid, "QmTestCid");
        assertEq(e.sourceCitations.length, 2);
    }

    function test_log_reasoning_rejects_invalid_score() public {
        vm.prank(admin);
        logger.grantRole(bot, 1);

        bytes32[] memory citations = new bytes32[](0);
        vm.prank(bot);
        vm.expectRevert(ReasoningLogger.InvalidPodScore.selector);
        logger.logReasoning(vault, bytes32(0), "", 0, 101, citations);
    }

    function test_log_reasoning_unauthorized() public {
        bytes32[] memory citations = new bytes32[](0);
        vm.prank(bot);
        vm.expectRevert(ReasoningLogger.NotAuthorized.selector);
        logger.logReasoning(vault, bytes32(0), "", 0, 50, citations);
    }

    function test_revoke_role_blocks_future_writes() public {
        vm.startPrank(admin);
        logger.grantRole(bot, 1);
        logger.revokeRole(bot, 1);
        vm.stopPrank();

        bytes32[] memory citations = new bytes32[](0);
        vm.prank(bot);
        vm.expectRevert(ReasoningLogger.NotAuthorized.selector);
        logger.logReasoning(vault, bytes32(0), "", 0, 50, citations);
    }

    function test_entries_are_sequential() public {
        vm.prank(admin);
        logger.grantRole(bot, 1);

        bytes32[] memory citations = new bytes32[](0);
        vm.startPrank(bot);
        for (uint256 i = 0; i < 5; i++) {
            uint256 id = logger.logReasoning(vault, bytes32(i), "", 0, uint256(50 + i), citations);
            assertEq(id, i);
        }
        vm.stopPrank();

        assertEq(logger.totalEntries(), 5);
    }
}
