// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/**
 * @title TitanChessEscrow
 * @notice Escrow + FIFO queue for human vs Stockfish (house) chess wagers on Titan C-Chain.
 *
 * The **contract** holds player stakes and a **house bankroll** (`houseBankroll`).
 * The operator wallet only starts matches and reports results — it does not post
 * per-game stake (only pays gas).
 *
 * Flow:
 *   1. Owner funds the house: `depositHouse()` (or send TITAN in constructor).
 *   2. Player calls `joinQueue()` with stake (native TITAN).
 *   3. Operator calls `startNextMatch()` — house stake is taken from `houseBankroll`.
 *   4. Operator calls `reportResult(gameId, outcome)` after the off-chain game.
 *
 * Payouts:
 *   - Player wins: player receives both stakes.
 *   - Stockfish wins: pot returns to `houseBankroll`.
 *   - Draw: player refunded; house stake returns to `houseBankroll`.
 */
contract TitanChessEscrow {
    enum GameStatus {
        Active,
        Finished,
        Cancelled
    }

    enum Outcome {
        None,
        PlayerWins,
        StockfishWins,
        Draw
    }

    struct QueuedPlayer {
        address player;
        uint256 stake;
        uint256 queuedAt;
    }

    struct Game {
        uint256 id;
        address player;
        uint256 playerStake;
        uint256 stockfishStake;
        GameStatus status;
        Outcome outcome;
        address winner;
        uint256 startedAt;
        uint256 finishedAt;
    }

    address public immutable stockfishOperator;
    address public owner;

    uint256 public minStake;
    uint256 public maxStake;

    /// @notice TITAN reserved to match player wagers (not queued player funds).
    uint256 public houseBankroll;

    uint256 public queueLength;
    uint256 public activeGames;
    uint256 public nextGameId;

    QueuedPlayer[] private _queue;
    mapping(uint256 => Game) public games;
    mapping(address => bool) public playerInActiveGame;
    mapping(address => bool) public playerInQueue;

    event HouseFunded(address indexed from, uint256 amount, uint256 newBalance);
    event HouseWithdrawn(address indexed to, uint256 amount, uint256 newBalance);
    event PlayerQueued(address indexed player, uint256 stake, uint256 position);
    event PlayerLeftQueue(address indexed player, uint256 stake);
    event MatchStarted(uint256 indexed gameId, address indexed player, uint256 stake);
    event MatchResolved(
        uint256 indexed gameId,
        Outcome outcome,
        address indexed winner,
        uint256 playerPayout,
        uint256 houseReturn
    );
    event StakesConfigUpdated(uint256 minStake, uint256 maxStake);

    modifier onlyOperator() {
        require(msg.sender == stockfishOperator, "TitanChessEscrow: not operator");
        _;
    }

    modifier onlyOwner() {
        require(msg.sender == owner, "TitanChessEscrow: not owner");
        _;
    }

    constructor(address _stockfishOperator, uint256 _minStake, uint256 _maxStake) payable {
        require(_stockfishOperator != address(0), "TitanChessEscrow: invalid operator");
        require(_minStake > 0, "TitanChessEscrow: min stake required");
        require(_maxStake >= _minStake, "TitanChessEscrow: invalid stake bounds");

        stockfishOperator = _stockfishOperator;
        owner = msg.sender;
        minStake = _minStake;
        maxStake = _maxStake;

        if (msg.value > 0) {
            houseBankroll = msg.value;
            emit HouseFunded(msg.sender, msg.value, houseBankroll);
        }
    }

    /// @notice Fund the house bankroll (contract-held escrow for Stockfish side).
    function depositHouse() external payable onlyOwner {
        require(msg.value > 0, "TitanChessEscrow: zero deposit");
        houseBankroll += msg.value;
        emit HouseFunded(msg.sender, msg.value, houseBankroll);
    }

    /// @notice Withdraw excess house bankroll (not while a match is active).
    function withdrawHouse(uint256 amount) external onlyOwner {
        require(activeGames == 0, "TitanChessEscrow: match active");
        require(amount > 0 && amount <= houseBankroll, "TitanChessEscrow: insufficient house");
        houseBankroll -= amount;
        _pay(owner, amount);
        emit HouseWithdrawn(owner, amount, houseBankroll);
    }

    /// @notice Join the FIFO queue with a native TITAN stake.
    function joinQueue() external payable {
        require(msg.value >= minStake && msg.value <= maxStake, "TitanChessEscrow: invalid stake");
        require(!playerInQueue[msg.sender], "TitanChessEscrow: already queued");
        require(!playerInActiveGame[msg.sender], "TitanChessEscrow: active game");
        require(activeGames == 0, "TitanChessEscrow: wait for current match");

        _queue.push(
            QueuedPlayer({player: msg.sender, stake: msg.value, queuedAt: block.timestamp})
        );
        playerInQueue[msg.sender] = true;
        queueLength = _queue.length;

        emit PlayerQueued(msg.sender, msg.value, _queue.length);
    }

    /// @notice Leave the queue and reclaim stake.
    function leaveQueue() external {
        require(playerInQueue[msg.sender], "TitanChessEscrow: not queued");

        uint256 len = _queue.length;
        for (uint256 i = 0; i < len; i++) {
            if (_queue[i].player == msg.sender) {
                uint256 stake = _queue[i].stake;
                _removeQueueAt(i);
                playerInQueue[msg.sender] = false;
                _pay(msg.sender, stake);
                emit PlayerLeftQueue(msg.sender, stake);
                return;
            }
        }

        revert("TitanChessEscrow: queue entry missing");
    }

    /// @notice Operator opens the next match; house stake comes from `houseBankroll`.
    function startNextMatch() external onlyOperator returns (uint256 gameId) {
        require(_queue.length > 0, "TitanChessEscrow: queue empty");
        require(activeGames == 0, "TitanChessEscrow: match in progress");

        QueuedPlayer memory nextPlayer = _queue[0];
        require(houseBankroll >= nextPlayer.stake, "TitanChessEscrow: house underfunded");

        houseBankroll -= nextPlayer.stake;

        _shiftQueue();
        playerInQueue[nextPlayer.player] = false;

        gameId = nextGameId++;
        activeGames = 1;
        playerInActiveGame[nextPlayer.player] = true;

        games[gameId] = Game({
            id: gameId,
            player: nextPlayer.player,
            playerStake: nextPlayer.stake,
            stockfishStake: nextPlayer.stake,
            status: GameStatus.Active,
            outcome: Outcome.None,
            winner: address(0),
            startedAt: block.timestamp,
            finishedAt: 0
        });

        emit MatchStarted(gameId, nextPlayer.player, nextPlayer.stake);
    }

    /// @notice Operator resolves an active match after the off-chain game ends.
    function reportResult(uint256 gameId, Outcome outcome) external onlyOperator {
        require(
            outcome == Outcome.PlayerWins ||
                outcome == Outcome.StockfishWins ||
                outcome == Outcome.Draw,
            "TitanChessEscrow: invalid outcome"
        );

        Game storage game = games[gameId];
        require(game.status == GameStatus.Active, "TitanChessEscrow: not active");

        game.status = GameStatus.Finished;
        game.outcome = outcome;
        game.finishedAt = block.timestamp;
        activeGames = 0;
        playerInActiveGame[game.player] = false;

        uint256 playerPayout;
        uint256 houseReturn;

        if (outcome == Outcome.PlayerWins) {
            game.winner = game.player;
            playerPayout = game.playerStake + game.stockfishStake;
            houseReturn = 0;
            _pay(game.player, playerPayout);
        } else if (outcome == Outcome.StockfishWins) {
            game.winner = address(0);
            playerPayout = 0;
            houseReturn = game.playerStake + game.stockfishStake;
            houseBankroll += houseReturn;
        } else {
            game.winner = address(0);
            playerPayout = game.playerStake;
            houseReturn = game.stockfishStake;
            _pay(game.player, playerPayout);
            houseBankroll += houseReturn;
        }

        emit MatchResolved(gameId, outcome, game.winner, playerPayout, houseReturn);
    }

    /// @notice Owner refunds a stuck match; stakes return to player and house bankroll.
    function cancelActiveGame(uint256 gameId) external onlyOwner {
        Game storage game = games[gameId];
        require(game.status == GameStatus.Active, "TitanChessEscrow: not active");

        game.status = GameStatus.Cancelled;
        game.finishedAt = block.timestamp;
        activeGames = 0;
        playerInActiveGame[game.player] = false;

        _pay(game.player, game.playerStake);
        houseBankroll += game.stockfishStake;

        emit MatchResolved(gameId, Outcome.Draw, address(0), game.playerStake, game.stockfishStake);
    }

    function setStakeBounds(uint256 _minStake, uint256 _maxStake) external onlyOwner {
        require(_minStake > 0, "TitanChessEscrow: min stake required");
        require(_maxStake >= _minStake, "TitanChessEscrow: invalid stake bounds");
        minStake = _minStake;
        maxStake = _maxStake;
        emit StakesConfigUpdated(_minStake, _maxStake);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "TitanChessEscrow: invalid owner");
        owner = newOwner;
    }

    function getQueueEntry(uint256 index)
        external
        view
        returns (address player, uint256 stake, uint256 queuedAt)
    {
        QueuedPlayer storage entry = _queue[index];
        return (entry.player, entry.stake, entry.queuedAt);
    }

    function peekNextPlayer() external view returns (address player, uint256 stake, uint256 queuedAt) {
        require(_queue.length > 0, "TitanChessEscrow: queue empty");
        QueuedPlayer storage entry = _queue[0];
        return (entry.player, entry.stake, entry.queuedAt);
    }

    function getGame(uint256 gameId)
        external
        view
        returns (
            address player,
            uint256 playerStake,
            uint256 stockfishStake,
            GameStatus status,
            Outcome outcome,
            address winner,
            uint256 startedAt,
            uint256 finishedAt
        )
    {
        Game storage game = games[gameId];
        return (
            game.player,
            game.playerStake,
            game.stockfishStake,
            game.status,
            game.outcome,
            game.winner,
            game.startedAt,
            game.finishedAt
        );
    }

    function _shiftQueue() private {
        uint256 len = _queue.length;
        require(len > 0, "TitanChessEscrow: queue empty");
        for (uint256 i = 0; i < len - 1; i++) {
            _queue[i] = _queue[i + 1];
        }
        _queue.pop();
        queueLength = _queue.length;
    }

    function _removeQueueAt(uint256 index) private {
        uint256 len = _queue.length;
        require(index < len, "TitanChessEscrow: bad index");
        if (index != len - 1) {
            _queue[index] = _queue[len - 1];
        }
        _queue.pop();
        queueLength = _queue.length;
    }

    function _pay(address to, uint256 amount) private {
        if (amount == 0) return;
        (bool ok, ) = to.call{value: amount}("");
        require(ok, "TitanChessEscrow: transfer failed");
    }
}