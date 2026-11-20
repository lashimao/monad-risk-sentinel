// SPDX-License-Identifier: MIT
pragma solidity ^0.8.30;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

interface IRiskSignalReader {
    function currentStatus(address asset) external view returns (uint8);
}

/// @notice Reference market for standard, valueless demo tokens with 6 decimals and fixed 1:1 valuation.
contract ReferenceLendingPool is ReentrancyGuard {
    using SafeERC20 for IERC20Metadata;

    uint16 public constant OPEN_LTV_BPS = 7500;
    uint16 public constant RESTRICTED_LTV_BPS = 4500;
    uint8 private constant OPEN_SIGNAL = 1;

    struct Position {
        uint256 collateral;
        uint256 debt;
    }

    IERC20Metadata public immutable collateralAsset;
    IERC20Metadata public immutable debtAsset;
    IRiskSignalReader public immutable registry;
    mapping(address account => Position) public positions;

    error InvalidMarket();
    error InvalidAmount();
    error BorrowingPaused();
    error BorrowLimitExceeded();
    error InsufficientLiquidity();
    error UnsafeWithdrawal();

    event CollateralDeposited(address indexed account, uint256 amount);
    event Borrowed(address indexed account, uint256 amount);
    event Repaid(address indexed account, uint256 amount);
    event CollateralWithdrawn(address indexed account, uint256 amount);

    constructor(IERC20Metadata collateralToken, IERC20Metadata debtToken, IRiskSignalReader signalReader) {
        if (
            address(collateralToken) == address(debtToken) || address(signalReader).code.length == 0
                || collateralToken.decimals() != 6 || debtToken.decimals() != 6
        ) revert InvalidMarket();

        collateralAsset = collateralToken;
        debtAsset = debtToken;
        registry = signalReader;
    }

    function policy() public view returns (uint16 ltvBps, bool borrowingAllowed) {
        borrowingAllowed = registry.currentStatus(address(collateralAsset)) == OPEN_SIGNAL;
        ltvBps = borrowingAllowed ? OPEN_LTV_BPS : RESTRICTED_LTV_BPS;
    }

    function depositCollateral(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        collateralAsset.safeTransferFrom(msg.sender, address(this), amount);
        positions[msg.sender].collateral += amount;
        emit CollateralDeposited(msg.sender, amount);
    }

    function borrow(uint256 amount) external nonReentrant {
        if (amount == 0) revert InvalidAmount();
        (uint16 ltvBps, bool allowed) = policy();
        if (!allowed) revert BorrowingPaused();
        Position storage position = positions[msg.sender];
        uint256 nextDebt = position.debt + amount;
        if (nextDebt > _debtLimit(position.collateral, ltvBps)) revert BorrowLimitExceeded();
        if (amount > debtAsset.balanceOf(address(this))) revert InsufficientLiquidity();
        position.debt = nextDebt;
        debtAsset.safeTransfer(msg.sender, amount);
        emit Borrowed(msg.sender, amount);
    }

    function repay(uint256 amount) external nonReentrant {
        Position storage position = positions[msg.sender];
        if (amount == 0 || amount > position.debt) revert InvalidAmount();
        position.debt -= amount;
        debtAsset.safeTransferFrom(msg.sender, address(this), amount);
        emit Repaid(msg.sender, amount);
    }

    function withdrawCollateral(uint256 amount) external nonReentrant {
        Position storage position = positions[msg.sender];
        if (amount == 0 || amount > position.collateral) revert InvalidAmount();
        uint256 remaining = position.collateral - amount;
        // Debt-free accounts can always exit, even if the registry is unavailable.
        if (position.debt != 0) {
            (uint16 ltvBps,) = policy();
            if (position.debt > _debtLimit(remaining, ltvBps)) revert UnsafeWithdrawal();
        }
        position.collateral = remaining;
        collateralAsset.safeTransfer(msg.sender, amount);
        emit CollateralWithdrawn(msg.sender, amount);
    }

    function _debtLimit(uint256 collateral, uint16 ltvBps) private pure returns (uint256) {
        return Math.mulDiv(collateral, ltvBps, 10_000);
    }
}

/// @notice Fixture debt asset. It has no peg or redemption rights.
contract ReplayCredit is ERC20 {
    constructor(address liquidityProvider) ERC20("Risk Sentinel Test Credit", "tCREDIT") {
        _mint(liquidityProvider, 1_000 * 10 ** decimals());
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }
}
