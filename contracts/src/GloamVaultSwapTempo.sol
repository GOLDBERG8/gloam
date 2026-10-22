// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {GloamVaultSwap} from "./GloamVaultSwap.sol";

/// @notice Tempo's enshrined Stablecoin DEX (an orderbook precompile).
interface IStablecoinDex {
    function swapExactAmountOut(address tokenIn, address tokenOut, uint128 amountOut, uint128 maxAmountIn)
        external
        returns (uint128 amountIn);
}

/**
 * @title GloamVaultSwapTempo
 * @notice Vault swaps between stablecoins on Tempo, through the Stablecoin DEX
 *         fixed at deploy. The DEX routes the pair itself, so there is no route
 *         to pass and none a caller could change. It pulls the input from this
 *         contract (TIP-20 implicit approval for the DEX; the approval set here
 *         covers any token without it and is cleared after) and sends the
 *         output straight back here.
 */
contract GloamVaultSwapTempo is GloamVaultSwap {
    IStablecoinDex public immutable dex;

    error BadRoute();

    constructor(address vault_, address treasury_, address dex_) GloamVaultSwap(vault_, treasury_) {
        if (dex_ == address(0)) revert ZeroAddress();
        dex = IStablecoinDex(dex_);
    }

    function _swapExactOut(
        address assetIn,
        address assetOut,
        uint256 amountOut,
        uint256 maxIn,
        bytes calldata route
    ) internal override returns (uint256 amountIn) {
        if (route.length != 0) revert BadRoute();
        if (amountOut > type(uint128).max) revert InvalidAmount();
        uint128 cap = maxIn > type(uint128).max ? type(uint128).max : uint128(maxIn);
        _approve(assetIn, address(dex), cap);
        amountIn = dex.swapExactAmountOut(assetIn, assetOut, uint128(amountOut), cap);
        _approve(assetIn, address(dex), 0);
    }
}
