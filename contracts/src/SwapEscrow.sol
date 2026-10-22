// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20Balance {
    function balanceOf(address account) external view returns (uint256);
}

/**
 * @notice One vault swap's drop-off point (GloamVaultSwap). The vault pays a
 *         swap's input here (the unshield proof names this address as `to`),
 *         and the router deploys it with CREATE2 in the same transaction: the
 *         constructor hands the whole balance to the router and leaves no code.
 * @dev Its own file, so the creation code (and every escrow address the app
 *      works out from it) does not change when GloamVaultSwap.sol is edited.
 */
contract SwapEscrow {
    constructor(address token) {
        uint256 amount = IERC20Balance(token).balanceOf(address(this));
        if (amount != 0) {
            (bool ok, bytes memory ret) = token.call(abi.encodeWithSelector(0xa9059cbb, msg.sender, amount));
            require(ok && (ret.length == 0 || abi.decode(ret, (bool))), "escrow transfer");
        }
        assembly {
            return(0, 0)
        }
    }
}
