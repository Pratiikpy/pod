// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {DrawdownGuard} from "./DrawdownGuard.sol";
import {ReasoningLogger} from "./ReasoningLogger.sol";

/// @title  PodVault
/// @notice User-funded vault that holds USDC, tracks NAV, and accepts rebalance
///         instructions from an authorized rebalancer (the off-chain signal engine).
///         Every rebalance is paired with a reasoning entry in ReasoningLogger,
///         making every decision auditable forever.
/// @dev    Wave 1 is intentionally minimal: USDC in, basket out (off-chain settlement
///         via SoDEX), drawdown guard wired in. Later waves can wrap an SSI AssetToken
///         to enable cross-chain baskets without changing this surface.
contract PodVault is ERC20, ReentrancyGuard {
    using SafeERC20 for IERC20;

    /// @notice The deposit asset. USDC on ValueChain (6 decimals).
    IERC20 public immutable depositAsset;

    /// @notice Per-vault drawdown guard.
    DrawdownGuard public immutable drawdownGuard;

    /// @notice Reasoning audit log.
    ReasoningLogger public immutable reasoningLogger;

    /// @notice Authorized rebalancer (off-chain signal engine bot).
    address public rebalancer;

    /// @notice Risk profile picked at construction (CHILL=0, BALANCED=1, SEND_IT=2).
    uint8 public immutable riskProfile;

    /// @notice Vault owner who can change rebalancer / pause.
    address public owner;

    /// @notice True when the vault has been paused (deposits/withdraws unrestricted, rebalances blocked).
    bool public paused;

    /// @notice Last accepted NAV (in USDC base units, 1e6 decimals).
    uint256 public lastNav;

    event Deposited(address indexed user, uint256 amount, uint256 sharesMinted);
    event Withdrawn(address indexed user, uint256 amount, uint256 sharesBurned);
    event Rebalanced(uint256 indexed reasoningId, uint256 newNav);
    event RebalancerUpdated(address indexed newRebalancer);
    event Paused(bool paused);
    event PanicWithdraw(address indexed user, uint256 amount);

    error NotOwner();
    error NotRebalancer();
    error PausedError();
    error ZeroAmount();
    error InsufficientShares();
    error DrawdownTripped();

    constructor(
        IERC20 depositAsset_,
        DrawdownGuard drawdownGuard_,
        ReasoningLogger reasoningLogger_,
        address owner_,
        address rebalancer_,
        uint8 riskProfile_,
        uint256 maxDrawdownBps,
        string memory name_,
        string memory symbol_
    ) ERC20(name_, symbol_) {
        depositAsset = depositAsset_;
        drawdownGuard = drawdownGuard_;
        reasoningLogger = reasoningLogger_;
        owner = owner_;
        rebalancer = rebalancer_;
        riskProfile = riskProfile_;
        drawdownGuard_.configure(maxDrawdownBps, 0);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyRebalancer() {
        if (msg.sender != rebalancer) revert NotRebalancer();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedError();
        _;
    }

    /// @notice Deposit USDC and mint vault shares 1:1 with NAV.
    function deposit(uint256 amount) external nonReentrant returns (uint256 shares) {
        if (amount == 0) revert ZeroAmount();
        depositAsset.safeTransferFrom(msg.sender, address(this), amount);
        uint256 supply = totalSupply();
        if (supply == 0 || lastNav == 0) {
            shares = amount;
        } else {
            shares = (amount * supply) / lastNav;
        }
        _mint(msg.sender, shares);
        lastNav += amount;
        emit Deposited(msg.sender, amount, shares);
    }

    /// @notice Burn shares and withdraw the proportional USDC. Uses lastNav for pricing.
    /// @dev    In production, this would settle through the basket (selling holdings on SoDEX).
    ///         Wave 1 simplification: vault holds USDC + claims to off-chain basket.
    function withdraw(uint256 shares) external nonReentrant returns (uint256 amount) {
        if (shares == 0) revert ZeroAmount();
        if (balanceOf(msg.sender) < shares) revert InsufficientShares();
        uint256 supply = totalSupply();
        amount = (shares * lastNav) / supply;
        _burn(msg.sender, shares);
        lastNav = lastNav > amount ? lastNav - amount : 0;
        depositAsset.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount, shares);
    }

    /// @notice Apply a rebalance — caller is the off-chain signal engine.
    /// @param newNav            Updated vault NAV (USDC base units).
    /// @param reasoningHash     keccak256 of the canonical reasoning JSON.
    /// @param ipfsCid           IPFS CID for full reasoning data.
    /// @param compositeZ        Scaled composite z-score (×1e6).
    /// @param podScore          Final POD Score 0-100.
    /// @param sourceCitations   Pre-hashed source identifiers used in this decision.
    function applyRebalance(
        uint256 newNav,
        bytes32 reasoningHash,
        string calldata ipfsCid,
        int256 compositeZ,
        uint256 podScore,
        bytes32[] calldata sourceCitations
    ) external onlyRebalancer whenNotPaused returns (uint256 reasoningId) {
        // Update NAV via drawdown guard, which will revert if it trips.
        bool tripped = drawdownGuard.updateNav(address(this), newNav);
        if (tripped) revert DrawdownTripped();

        lastNav = newNav;

        reasoningId = reasoningLogger.logReasoning(
            address(this),
            reasoningHash,
            ipfsCid,
            compositeZ,
            podScore,
            sourceCitations
        );
        emit Rebalanced(reasoningId, newNav);
    }

    /// @notice Update the off-chain rebalancer address.
    function setRebalancer(address newRebalancer) external onlyOwner {
        rebalancer = newRebalancer;
        emit RebalancerUpdated(newRebalancer);
    }

    /// @notice Pause / unpause the vault.
    function setPaused(bool paused_) external onlyOwner {
        paused = paused_;
        emit Paused(paused_);
    }

    /// @notice Emergency owner withdrawal (for recovery scenarios).
    /// @dev    Withdraws all available USDC to the owner. Does not affect share supply,
    ///         but a paused vault should follow this with a coordinated user-by-user
    ///         payout schedule. Use only when paused.
    function panicWithdraw() external onlyOwner {
        if (!paused) revert PausedError();
        uint256 bal = depositAsset.balanceOf(address(this));
        if (bal == 0) revert ZeroAmount();
        depositAsset.safeTransfer(owner, bal);
        emit PanicWithdraw(owner, bal);
    }

    /// @notice Per-share NAV in USDC base units, scaled by 1e18 for precision.
    function pricePerShare() external view returns (uint256) {
        uint256 supply = totalSupply();
        if (supply == 0) return 1e18;
        return (lastNav * 1e18) / supply;
    }
}
