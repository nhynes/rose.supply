// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

contract FaucetV1 {
    uint256 private constant SECONDS_IN_DAY = 24 * 60 * 60;

    /// Enough to make an ERC-20 transfer at 100 Gwei per gas.
    uint256 public _payout = 0.003 ether;
    uint256 public _maxDailyPayouts = 500;
    mapping(uint256 => uint256) public _payoutsToday;
    mapping(address => bool) public _agents;

    address public _admin;
    address public _proposedAdmin;
    uint256 public _newAdminStartTime;

    event Donation(address from, uint256 amount, bytes message);
    event AgentsAuthorized(address[] agents);
    event AgentsDeauthorized(address[] formerAgents);

    event AdminProposed(address newAdmin, uint256 startTime);
    event AdminChanged(address newAdmin);

    constructor() payable {
        _admin = msg.sender;
    }

    modifier onlyAdmin() {
        require(msg.sender == _admin, "not admin");
        _;
    }

    /// Pays out the `_payout` to the recipients.
    /// The caller must ensure that no recipients are contracts.
    /// The caller should also dedupe the recipients.
    function payoutBatch(address payable[] calldata recipients) external {
        if (_payout == 0) return;
        require(_agents[msg.sender], "not agent");
        uint256 today = block.timestamp / SECONDS_IN_DAY;
        uint256 payoutsToday = _payoutsToday[today];
        uint256 numPayouts = payoutsToday + recipients.length > _maxDailyPayouts
            ? _maxDailyPayouts - payoutsToday
            : recipients.length;
        require(numPayouts > 0, "dry");
        _payoutsToday[today] = payoutsToday + numPayouts;
        for (uint256 i = 0; i < numPayouts; ++i) {
            recipients[i].transfer(_payout);
        }
    }

    /// Sends a donation along with a publicly visible message.
    function donate(bytes calldata message) external payable {
        if (msg.value == 0) return;
        emit Donation(msg.sender, msg.value, message);
    }

    /// Receives a donation without an attached message.
    receive() external payable {
        if (msg.value == 0) return;
        emit Donation(msg.sender, msg.value, bytes(""));
    }

    function authorizeAgents(address[] calldata agents) external onlyAdmin {
        for (uint256 i = 0; i < agents.length; ++i) {
            _agents[agents[i]] = true;
        }
        emit AgentsAuthorized(agents);
    }

    function deauthorizeAgents(address[] calldata formerAgents)
        external
        onlyAdmin
    {
        for (uint256 i = 0; i < formerAgents.length; ++i) {
            delete _agents[formerAgents[i]];
        }
        emit AgentsDeauthorized(formerAgents);
    }

    /// Allows updating the payout if the minimum gas price changes.
    function adjustPayout(uint256 newPayout) external onlyAdmin {
        require(newPayout <= 0.01 ether, "too generous");
        _payout = newPayout;
    }

    function adjustMaxDailyPayout(uint256 newMaxDailyPayouts)
        external
        onlyAdmin
    {
        require(newMaxDailyPayouts < 20_000, "too generous");
        _maxDailyPayouts = newMaxDailyPayouts;
    }

    function proposeNewAdmin(address newAdmin) external onlyAdmin {
        uint256 startTime = newAdmin != address(0)
            ? block.timestamp + 7 days
            : type(uint256).max;
        _newAdminStartTime = startTime;
        _proposedAdmin = newAdmin;
        emit AdminProposed(newAdmin, startTime);
    }

    function acceptAdminRole() external {
        require(msg.sender == _proposedAdmin, "not proposed");
        require(block.timestamp >= _newAdminStartTime, "not time");
        address newAdmin = _proposedAdmin;
        _admin = newAdmin;
        delete _proposedAdmin;
        delete _newAdminStartTime;
        emit AdminChanged(newAdmin);
    }
}
