// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title  DrawdownGuard
/// @notice Tracks per-vault high-water mark and triggers a forced de-risk
///         signal when realised + unrealised drawdown exceeds the user's
///         configured cap. Off-chain executor watches `Triggered` events
///         and rotates positions to stables via SoDEX.
/// @dev    The contract itself does not move funds — it emits an authoritative
///         on-chain trigger that off-chain workers must honour. This keeps the
///         contract simple and the execution flexible (spot vs perp, partial
///         vs full exit, pause vs sell).
contract DrawdownGuard {
    struct Config {
        uint256 maxDrawdownBps; // 500 = 5%, 1000 = 10%, 2000 = 20%
        uint256 highWaterMark; // peak vault NAV (in USDC, 1e6 decimals)
        uint256 currentNav;
        bool tripped;
        uint64 lastUpdate;
    }

    /// @notice One config per vault.
    mapping(address => Config) public configs;

    /// @notice Authorized oracles who can update NAVs.
    mapping(address => bool) public oracles;

    /// @notice Owner can manage oracles + emergency reset.
    address public owner;

    event ConfigSet(address indexed vault, uint256 maxDrawdownBps);
    event NavUpdated(address indexed vault, uint256 newNav, uint256 highWaterMark, int256 drawdownBps);
    event Triggered(address indexed vault, uint256 navAtTrigger, uint256 highWaterMark, uint256 drawdownBps);
    event Reset(address indexed vault, uint256 newHighWaterMark);
    event OracleSet(address indexed oracle, bool enabled);

    error NotOwner();
    error NotOracle();
    error InvalidConfig();
    error AlreadyTripped();

    constructor(address owner_) {
        owner = owner_;
        oracles[owner_] = true;
        emit OracleSet(owner_, true);
    }

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOracle() {
        if (!oracles[msg.sender]) revert NotOracle();
        _;
    }

    function setOracle(address oracle, bool enabled) external onlyOwner {
        oracles[oracle] = enabled;
        emit OracleSet(oracle, enabled);
    }

    /// @notice Initial setup for a vault. Caller becomes the vault.
    /// @param maxDrawdownBps  Cap in basis points. e.g. 1000 = 10% max drawdown.
    /// @param initialNav      Starting NAV in USDC (1e6 decimals). Acts as initial HWM.
    function configure(uint256 maxDrawdownBps, uint256 initialNav) external {
        if (maxDrawdownBps == 0 || maxDrawdownBps > 5000) revert InvalidConfig();
        configs[msg.sender] = Config({
            maxDrawdownBps: maxDrawdownBps,
            highWaterMark: initialNav,
            currentNav: initialNav,
            tripped: false,
            lastUpdate: uint64(block.timestamp)
        });
        emit ConfigSet(msg.sender, maxDrawdownBps);
    }

    /// @notice Push a fresh NAV. Updates HWM if NAV is new high. Trips if drawdown breached.
    /// @dev    Returns true iff this update tripped the guard.
    function updateNav(address vault, uint256 newNav) external onlyOracle returns (bool tripped) {
        Config storage cfg = configs[vault];
        if (cfg.maxDrawdownBps == 0) revert InvalidConfig();
        if (cfg.tripped) revert AlreadyTripped();

        cfg.currentNav = newNav;
        cfg.lastUpdate = uint64(block.timestamp);

        if (newNav > cfg.highWaterMark) {
            cfg.highWaterMark = newNav;
        }

        int256 ddBps = computeDrawdownBps(cfg.highWaterMark, newNav);
        emit NavUpdated(vault, newNav, cfg.highWaterMark, ddBps);

        if (ddBps >= int256(cfg.maxDrawdownBps)) {
            cfg.tripped = true;
            emit Triggered(vault, newNav, cfg.highWaterMark, uint256(ddBps));
            return true;
        }
        return false;
    }

    /// @notice Reset a tripped guard with a new starting NAV.
    function reset(address vault, uint256 newNav) external onlyOwner {
        Config storage cfg = configs[vault];
        cfg.tripped = false;
        cfg.highWaterMark = newNav;
        cfg.currentNav = newNav;
        cfg.lastUpdate = uint64(block.timestamp);
        emit Reset(vault, newNav);
    }

    function isTripped(address vault) external view returns (bool) {
        return configs[vault].tripped;
    }

    function getDrawdownBps(address vault) external view returns (int256) {
        Config memory cfg = configs[vault];
        return computeDrawdownBps(cfg.highWaterMark, cfg.currentNav);
    }

    function computeDrawdownBps(uint256 hwm, uint256 nav) public pure returns (int256) {
        if (hwm == 0) return 0;
        if (nav >= hwm) return 0;
        unchecked {
            uint256 dd = ((hwm - nav) * 10_000) / hwm;
            return int256(dd);
        }
    }
}
