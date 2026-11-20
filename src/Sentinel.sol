// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";

contract RiskRegistry is Ownable {
    enum Status { Unknown, Open, Restrict }

    struct Signal {
        bytes32 evidenceHash;
        uint64 updatedAt;
        uint64 validUntil;
        uint64 revision;
        Status status;
    }

    uint64 public constant MAX_VALIDITY = 7 days;
    mapping(address asset => Signal) public signals;
    mapping(address reporter => bool) public reporters;

    error UnauthorizedReporter();
    error InvalidSignal();
    error StaleRevision(uint64 actual);

    event ReporterSet(address indexed reporter, bool enabled);
    event SignalPublished(
        address indexed asset, uint64 indexed revision, Status status, bytes32 evidenceHash, uint64 validUntil
    );

    constructor(address admin) Ownable(admin) {
        reporters[admin] = true;
        emit ReporterSet(admin, true);
    }

    function setReporter(address reporter, bool enabled) external onlyOwner {
        if (reporter == address(0)) revert InvalidSignal();
        reporters[reporter] = enabled;
        emit ReporterSet(reporter, enabled);
    }

    function publish(address asset, Status status, bytes32 evidenceHash, uint64 validUntil, uint64 expectedRevision)
        external
    {
        if (!reporters[msg.sender]) revert UnauthorizedReporter();
        if (
            asset == address(0) || status == Status.Unknown || evidenceHash == bytes32(0)
                || validUntil <= block.timestamp || validUntil > block.timestamp + MAX_VALIDITY
        ) revert InvalidSignal();

        uint64 current = signals[asset].revision;
        if (current != expectedRevision) revert StaleRevision(current);
        uint64 next = current + 1;
        signals[asset] = Signal(evidenceHash, uint64(block.timestamp), validUntil, next, status);
        emit SignalPublished(asset, next, status, evidenceHash, validUntil);
    }

    function currentStatus(address asset) public view returns (Status) {
        Signal storage signal = signals[asset];
        if (signal.validUntil <= block.timestamp) return Status.Unknown;
        return signal.status;
    }
}

/// @notice An opt-in ERC-4626 consumer for a test asset. Only inflows use the registry.
contract ProtectedDemoVault is ERC4626 {
    RiskRegistry public immutable registry;
    bool public immutable enforceSignal;
    error InflowsRestricted();

    constructor(IERC20 testAsset, RiskRegistry riskRegistry, bool gateInflows)
        ERC20("Sentinel Demo Vault", "sdUSD")
        ERC4626(testAsset)
    {
        registry = riskRegistry;
        enforceSignal = gateInflows;
    }

    function depositsAllowed() public view returns (bool) {
        RiskRegistry.Status status = registry.currentStatus(asset());
        return !enforceSignal || status == RiskRegistry.Status.Open;
    }

    function maxDeposit(address receiver) public view override returns (uint256) {
        return depositsAllowed() ? super.maxDeposit(receiver) : 0;
    }

    function maxMint(address receiver) public view override returns (uint256) {
        return depositsAllowed() ? super.maxMint(receiver) : 0;
    }

    function _deposit(address caller, address receiver, uint256 assets, uint256 shares) internal override {
        if (!depositsAllowed()) revert InflowsRestricted();
        super._deposit(caller, receiver, assets, shares);
    }
}

/// @notice Valueless fixture token. This contract is unrelated to Circle and USDC.
contract ReplayUSD is ERC20 {
    constructor(address demoUser) ERC20("Risk Sentinel Test USD", "tUSD") {
        _mint(demoUser, 1000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
