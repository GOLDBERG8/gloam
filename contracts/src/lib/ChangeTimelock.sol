// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * @title ChangeTimelock
 * @notice Setup-then-timelock governance for a pool's rule-changing setters.
 *
 *  - Setup mode (true at construction): the owner may call the pool's setters
 *    directly, with instant effect, so a deploy script can wire verifiers and
 *    rates in the same run.
 *  - endSetup(): one-way switch. After it, the setters revert when called
 *    directly. The only way to change a rule is:
 *        queueChange(call)   -> public ChangeQueued event, eta = now + CHANGE_DELAY
 *        (wait CHANGE_DELAY)
 *        executeChange(call) -> within [eta, eta + CHANGE_GRACE], runs once
 *    or cancelChange(call) to drop it. Users see every pending rule change on
 *    chain at least CHANGE_DELAY before it can take effect.
 *
 * `call` is exactly the ABI-encoded setter call (selector + static args), e.g.
 * abi.encodeCall(Pool.setSwapRate, (a, b, 1, 1, true)). The id is keccak256(call).
 *
 * Only selectors the inheriting pool whitelists in _changeArgWords() can be
 * queued, and execution goes through the pool's internal _applyChange() dispatch
 * (no external self-call, no arbitrary target), so nothing but those setters is
 * reachable. The queue entry is deleted before the change is applied, so a
 * queued call runs at most once; none of the setters make external calls.
 */
abstract contract ChangeTimelock {
    /// @notice Minimum public notice between queueing and executing a change.
    uint256 public constant CHANGE_DELAY = 3 days;
    /// @notice Window after eta in which a queued change may run; after it, re-queue.
    uint256 public constant CHANGE_GRACE = 14 days;

    /// @notice True until the owner calls endSetup(). Irreversible once false.
    bool public setupMode = true;

    /// @notice keccak256(call) => eta (0 = not queued).
    mapping(bytes32 => uint256) public changeEta;

    event SetupEnded(address indexed by);
    event ChangeQueued(bytes32 indexed id, bytes call, uint256 eta);
    event ChangeExecuted(bytes32 indexed id);
    event ChangeCancelled(bytes32 indexed id);

    error TimelockRequired();
    error SetupAlreadyEnded();
    error SetupActive();
    error UnknownChange();
    error BadChangeLength();
    error ChangeAlreadyQueued();
    error ChangeNotQueued();
    error ChangeNotReady();
    error ChangeExpired();

    /// @dev Direct setter calls are only allowed while in setup mode.
    modifier onlySetup() {
        if (!setupMode) revert TimelockRequired();
        _;
    }

    /// @notice Permanently end setup mode. From here on every rule change is timelocked.
    function endSetup() external {
        _checkOwner();
        if (!setupMode) revert SetupAlreadyEnded();
        _checkReadyToEndSetup();
        setupMode = false;
        emit SetupEnded(msg.sender);
    }

    /// @dev A pool that must be fully wired before it goes live reverts here.
    function _checkReadyToEndSetup() internal view virtual {}

    /// @notice Announce a setter call. It can run between eta and eta + CHANGE_GRACE.
    function queueChange(bytes calldata call) external returns (bytes32 id, uint256 eta) {
        _checkOwner();
        // During setup the owner calls setters directly; queueing only exists after
        // setup, so watchers need only scan ChangeQueued events from SetupEnded on.
        if (setupMode) revert SetupActive();
        _validateChange(call);
        id = keccak256(call);
        uint256 current = changeEta[id];
        // A still-live entry cannot be re-queued (that would silently move its eta).
        // An expired one may be replaced by a fresh queue.
        if (current != 0 && block.timestamp <= current + CHANGE_GRACE) {
            revert ChangeAlreadyQueued();
        }
        eta = block.timestamp + CHANGE_DELAY;
        changeEta[id] = eta;
        emit ChangeQueued(id, call, eta);
    }

    /// @notice Apply a queued change once its delay has passed. Runs at most once.
    function executeChange(bytes calldata call) external {
        _checkOwner();
        bytes32 id = keccak256(call);
        uint256 eta = changeEta[id];
        if (eta == 0) revert ChangeNotQueued();
        if (block.timestamp < eta) revert ChangeNotReady();
        if (block.timestamp > eta + CHANGE_GRACE) revert ChangeExpired();
        // Effects before the change is applied: a replay (same tx or later) finds
        // no entry and reverts ChangeNotQueued.
        delete changeEta[id];
        _applyChange(bytes4(call[:4]), call[4:]);
        emit ChangeExecuted(id);
    }

    /// @notice Drop a queued (or expired) change.
    function cancelChange(bytes calldata call) external {
        _checkOwner();
        bytes32 id = keccak256(call);
        if (changeEta[id] == 0) revert ChangeNotQueued();
        delete changeEta[id];
        emit ChangeCancelled(id);
    }

    /// @notice Helper for off-chain tooling: the id a given call is queued under.
    function changeId(bytes calldata call) external pure returns (bytes32) {
        return keccak256(call);
    }

    function _validateChange(bytes calldata call) internal pure {
        if (call.length < 4) revert UnknownChange();
        uint256 words = _changeArgWords(bytes4(call[:4]));
        if (words == 0) revert UnknownChange();
        // Canonical encoding only (all whitelisted setters take static args), so one
        // change has exactly one id and the queued bytes decode cleanly off-chain.
        if (call.length != 4 + 32 * words) revert BadChangeLength();
    }

    /// @dev Revert unless msg.sender is the owner.
    function _checkOwner() internal view virtual;

    /// @dev Number of 32-byte static args for a timelockable setter selector, 0 if not allowed.
    function _changeArgWords(bytes4 selector) internal pure virtual returns (uint256);

    /// @dev Apply a validated, queued, matured change. Must not make external calls.
    function _applyChange(bytes4 selector, bytes calldata args) internal virtual;
}
