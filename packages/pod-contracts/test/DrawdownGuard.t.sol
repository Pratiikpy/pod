// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Test} from "forge-std/Test.sol";
import {DrawdownGuard} from "../src/DrawdownGuard.sol";

contract DrawdownGuardTest is Test {
    DrawdownGuard guard;
    address owner = address(0xA1);
    address oracle = address(0xB1);
    address vault = address(0xC1);

    function setUp() public {
        vm.prank(owner);
        guard = new DrawdownGuard(owner);
        vm.prank(owner);
        guard.setOracle(oracle, true);

        // vault configures itself
        vm.prank(vault);
        guard.configure(1000, 1000e6); // 10% cap, $1000 starting
    }

    function test_drawdown_calc() public view {
        // 10% drop: HWM=1000, NAV=900 → 1000 bps
        assertEq(guard.computeDrawdownBps(1000e6, 900e6), 1000);
        // 5% drop
        assertEq(guard.computeDrawdownBps(1000e6, 950e6), 500);
        // No drop (above HWM)
        assertEq(guard.computeDrawdownBps(1000e6, 1100e6), 0);
        // Zero HWM
        assertEq(guard.computeDrawdownBps(0, 1000e6), 0);
    }

    function test_update_nav_below_threshold_does_not_trip() public {
        vm.prank(oracle);
        bool tripped = guard.updateNav(vault, 950e6); // 5% drop
        assertFalse(tripped);
        assertFalse(guard.isTripped(vault));
    }

    function test_update_nav_at_threshold_trips() public {
        vm.prank(oracle);
        bool tripped = guard.updateNav(vault, 900e6); // exactly 10% drop
        assertTrue(tripped);
        assertTrue(guard.isTripped(vault));
    }

    function test_update_nav_above_hwm_lifts_hwm() public {
        vm.prank(oracle);
        guard.updateNav(vault, 1500e6); // new high

        // 10% from new HWM = 1350
        vm.prank(oracle);
        bool tripped = guard.updateNav(vault, 1400e6); // small drop, no trip
        assertFalse(tripped);

        vm.prank(oracle);
        tripped = guard.updateNav(vault, 1350e6); // exactly 10% from 1500
        assertTrue(tripped);
    }

    function test_only_oracle_can_update_nav() public {
        vm.expectRevert(DrawdownGuard.NotOracle.selector);
        guard.updateNav(vault, 900e6);
    }

    function test_only_owner_can_set_oracle() public {
        vm.prank(oracle); // oracle isn't owner
        vm.expectRevert(DrawdownGuard.NotOwner.selector);
        guard.setOracle(address(0xFFFF), true);
    }

    function test_cannot_update_after_tripped() public {
        vm.prank(oracle);
        guard.updateNav(vault, 900e6); // trip
        vm.prank(oracle);
        vm.expectRevert(DrawdownGuard.AlreadyTripped.selector);
        guard.updateNav(vault, 950e6);
    }

    function test_reset_clears_trip_and_sets_new_hwm() public {
        vm.prank(oracle);
        guard.updateNav(vault, 900e6);
        assertTrue(guard.isTripped(vault));

        vm.prank(owner);
        guard.reset(vault, 950e6);

        assertFalse(guard.isTripped(vault));
        // Now 10% drop from 950 = 855
        vm.prank(oracle);
        bool tripped = guard.updateNav(vault, 856e6);
        assertFalse(tripped);
    }

    function test_invalid_config_too_high() public {
        vm.prank(vault);
        vm.expectRevert(DrawdownGuard.InvalidConfig.selector);
        guard.configure(5001, 1000e6);
    }

    function test_invalid_config_zero() public {
        vm.prank(vault);
        vm.expectRevert(DrawdownGuard.InvalidConfig.selector);
        guard.configure(0, 1000e6);
    }
}
