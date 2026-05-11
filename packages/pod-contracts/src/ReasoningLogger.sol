// SPDX-License-Identifier: MIT
pragma solidity ^0.8.25;

/// @title  ReasoningLogger
/// @notice Append-only audit log of every signal-driven decision POD makes.
///         Each log entry includes the off-chain reasoning hash + sources cited,
///         plus a pointer to the IPFS CID where the full reasoning + data is stored.
/// @dev    Anyone can read; only authorized loggers can write. By design the log
///         is immutable — never overwritten, never deleted. Bots, dashboards,
///         regulators, and judges can replay any decision in history.
contract ReasoningLogger {
    /// @notice One reasoning entry per emitted decision.
    struct Entry {
        uint256 id;
        uint256 timestamp;
        address vault;
        address actor;
        bytes32 reasoningHash;
        string ipfsCid;
        int256 compositeZ; // scaled 1e6
        uint256 podScore;
        bytes32[] sourceCitations;
    }

    /// @notice Roles bitfield: 1 = LOGGER, 2 = ADMIN.
    mapping(address => uint8) public roles;

    /// @notice Sequential entries, indexed by id.
    mapping(uint256 => Entry) public entries;

    /// @notice Total number of entries written.
    uint256 public totalEntries;

    event RoleGranted(address indexed account, uint8 role);
    event RoleRevoked(address indexed account, uint8 role);
    event ReasoningLogged(
        uint256 indexed id,
        address indexed vault,
        address indexed actor,
        bytes32 reasoningHash,
        int256 compositeZ,
        uint256 podScore,
        string ipfsCid
    );

    error NotAuthorized();
    error InvalidPodScore();

    uint8 internal constant ROLE_LOGGER = 1;
    uint8 internal constant ROLE_ADMIN = 2;

    constructor(address admin) {
        roles[admin] = ROLE_LOGGER | ROLE_ADMIN;
        emit RoleGranted(admin, ROLE_LOGGER | ROLE_ADMIN);
    }

    modifier onlyAdmin() {
        if (roles[msg.sender] & ROLE_ADMIN == 0) revert NotAuthorized();
        _;
    }

    modifier onlyLogger() {
        if (roles[msg.sender] & ROLE_LOGGER == 0) revert NotAuthorized();
        _;
    }

    /// @notice Grant a bitmask of roles to an account.
    function grantRole(address account, uint8 role) external onlyAdmin {
        roles[account] |= role;
        emit RoleGranted(account, role);
    }

    /// @notice Revoke a bitmask of roles from an account.
    function revokeRole(address account, uint8 role) external onlyAdmin {
        roles[account] &= ~role;
        emit RoleRevoked(account, role);
    }

    /// @notice Log a reasoning entry. Cannot be modified after writing.
    /// @param vault          Address of the PodVault this decision affected.
    /// @param reasoningHash  keccak256 of the canonical reasoning JSON (off-chain).
    /// @param ipfsCid        Optional IPFS CID where full reasoning is stored.
    /// @param compositeZ     Scaled (×1e6) composite z-score from the signal engine.
    /// @param podScore       Final POD Score 0-100.
    /// @param sourceCitations  Pre-hashed identifiers of each data source used.
    function logReasoning(
        address vault,
        bytes32 reasoningHash,
        string calldata ipfsCid,
        int256 compositeZ,
        uint256 podScore,
        bytes32[] calldata sourceCitations
    ) external onlyLogger returns (uint256 id) {
        if (podScore > 100) revert InvalidPodScore();
        id = totalEntries;
        entries[id] = Entry({
            id: id,
            timestamp: block.timestamp,
            vault: vault,
            actor: msg.sender,
            reasoningHash: reasoningHash,
            ipfsCid: ipfsCid,
            compositeZ: compositeZ,
            podScore: podScore,
            sourceCitations: sourceCitations
        });
        unchecked {
            totalEntries = id + 1;
        }
        emit ReasoningLogged(id, vault, msg.sender, reasoningHash, compositeZ, podScore, ipfsCid);
    }

    function getEntry(uint256 id) external view returns (Entry memory) {
        return entries[id];
    }
}
