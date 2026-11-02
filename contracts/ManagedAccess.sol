//SPDX-License-Identifier : MIT
pragma solidity ^0.8.28;

abstract contract ManagedAccess {
    address public owner;
    address public manager;
    address[] public managers;
    mapping(address => bool) public isManager;
    mapping(address => mapping(bytes32 => uint256)) public confirmations;
    uint256 public confirmationRound = 1;
    constructor(address _owner, address _manager) {
        owner = _owner;
        manager = _manager;
    }
    modifier onlyOwner() {
        require(msg.sender == owner, "You are not authorized");
        _;
    }
    modifier onlyManager() {
        require(
            msg.sender == manager,
            "You are not authorized to manage this contract"
        );
        _;
    }

    function setManagers(address[] calldata _managers) external onlyOwner {
        require(_managers.length >= 3, "At least 3 managers required");
        for (uint256 i = 0; i < managers.length; i++) {
            isManager[managers[i]] = false;
        }
        delete managers;
        for (uint256 i = 0; i < _managers.length; i++) {
            address account = _managers[i];
            require(account != address(0), "Invalid manager");
            require(!isManager[account], "Duplicate manager");
            isManager[account] = true;
            managers.push(account);
        }
        confirmationRound++;
    }

    function confirm(bytes calldata _data) external {
        require(isManager[msg.sender], "You are not a manager");
        confirmations[msg.sender][keccak256(_data)] = confirmationRound;
    }

    modifier onlyAllConfirmed() {
        require(isManager[msg.sender], "You are not a manager");
        bytes32 operation = keccak256(msg.data);
        for (uint256 i = 0; i < managers.length; i++) {
            require(
                confirmations[managers[i]][operation] == confirmationRound,
                "Not all confirmed yet"
            );
        }
        confirmationRound++;
        _;
    }
}
