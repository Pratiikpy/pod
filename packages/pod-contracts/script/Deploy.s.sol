// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {Script, console2} from "forge-std/Script.sol";
import {ReasoningLogger} from "../src/ReasoningLogger.sol";
import {DrawdownGuard} from "../src/DrawdownGuard.sol";
import {PodVault} from "../src/PodVault.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @notice Wave 1 deploy script.
/// @dev    Deploys ReasoningLogger + DrawdownGuard. PodVaults are deployed per-user
///         from the bot/worker on first deposit (cheaper than a factory for now).
///
/// Run:
///   forge script script/Deploy.s.sol:DeployScript \
///     --rpc-url $VALUECHAIN_TESTNET_RPC \
///     --private-key $DEPLOYER_PRIVATE_KEY \
///     --broadcast \
///     -vvv
contract DeployScript is Script {
    function run() external returns (address logger, address guard) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);

        console2.log("Deployer:", deployer);
        console2.log("Chain ID:", block.chainid);

        vm.startBroadcast(deployerKey);

        ReasoningLogger reasoningLogger = new ReasoningLogger(deployer);
        console2.log("ReasoningLogger:", address(reasoningLogger));

        DrawdownGuard drawdownGuard = new DrawdownGuard(deployer);
        console2.log("DrawdownGuard:", address(drawdownGuard));

        vm.stopBroadcast();
        return (address(reasoningLogger), address(drawdownGuard));
    }
}

/// @notice Per-user vault deployment, called by the bot's worker once a user funds.
contract DeployVaultScript is Script {
    function run() external returns (address vault) {
        uint256 deployerKey = vm.envUint("DEPLOYER_PRIVATE_KEY");
        address user = vm.envAddress("VAULT_OWNER");
        address rebalancer = vm.envAddress("REBALANCER_ADDRESS");
        address logger = vm.envAddress("REASONING_LOGGER_ADDRESS");
        address guard = vm.envAddress("DRAWDOWN_GUARD_ADDRESS");
        address usdc = vm.envAddress("USDC_ADDRESS");
        uint8 risk = uint8(vm.envUint("RISK_PROFILE")); // 0,1,2
        uint256 maxDdBps = vm.envUint("MAX_DRAWDOWN_BPS");
        string memory name = vm.envOr("VAULT_NAME", string("POD Vault"));
        string memory symbol = vm.envOr("VAULT_SYMBOL", string("podVAULT"));

        vm.startBroadcast(deployerKey);
        PodVault v = new PodVault(
            IERC20(usdc),
            DrawdownGuard(guard),
            ReasoningLogger(logger),
            user,
            rebalancer,
            risk,
            maxDdBps,
            name,
            symbol
        );
        vm.stopBroadcast();

        // Authorise the vault to write to the logger (admin must approve in a separate tx).
        console2.log("PodVault:", address(v));
        console2.log("  owner:", user);
        console2.log("  rebalancer:", rebalancer);
        console2.log("  risk profile:", risk);
        console2.log("  max DD bps:", maxDdBps);
        return address(v);
    }
}
