# Discord Bank Bot

## Overview
A Discord bot that manages a virtual banking system with Arabic UI. Users can register accounts, transfer funds, check balances, and admins can manage accounts through a comprehensive admin panel.

## Project Details
- **Language**: Node.js (JavaScript)
- **Main Framework**: discord.js v14
- **Database**: File-based JSON storage
- **Language Support**: Arabic (UI and messages)

## Architecture

### Core Files
- `index.js` - Main bot entry point, handles all interactions and events
- `deploy-commands.js` - Registers slash commands with Discord API
- `config.json` - Bot configuration (channel IDs, roles, fees, ranks)
- `permissions.json` - Role-based permissions mapping
- `database/users.json` - User data storage (auto-created)

### Commands Directory
- `register.js` - Account registration modal
- `account.js` - Check account balance and info
- `transfer.js` - Transfer funds between users
- `rank.js` - View available ranks
- `admin.js` - Admin control panel
- `support.js` - User support system

### User Model
Each user record contains:
- Personal info: name, country, age, birth date
- Account info: balance, rank, status (pending/approved/rejected/blacklisted)
- Type info: kind (مدني/عصابة/فصيل), faction (for فصيل type)
- Freeze status and income

## Setup

### Required Secrets
The following environment variables are required:
- `TOKEN` - Discord bot token from Discord Developer Portal
- `CLIENT_ID` - Discord application client ID

### Configuration
Update `config.json` with your Discord server details:
- `ADMIN_CHANNEL_ID` - Channel for admin review of registrations
- `ADMIN_LOG_CHANNEL_ID` - Channel for admin action logs
- `REGISTER_CHANNEL_ID` - Channel where users can register
- `ADMIN_CHAT_CHANNEL_ID` - Admin chat channel
- `ADMIN_ROLE_ID` - Role ID for administrators
- `CURRENCY_SYMBOL` - Currency symbol (default: $)
- `ranks` - Available account ranks
- `fees` - Transaction fees (deposit, transfer, withdraw)
- `MIN_DEPOSIT` - Minimum income requirement

Update `permissions.json` with your role IDs for various permissions.

### Deployment
To deploy slash commands to Discord:
```bash
node deploy-commands.js
```

## Features

### User Features
- Account registration with validation
- Balance checking
- Fund transfers between users
- Rank viewing
- Support ticket system

### Admin Features
- Approve/reject registrations
- User account management
- Add balance to accounts
- Freeze/unfreeze accounts
- Promote users (change ranks)
- Blacklist users
- Edit transaction fees
- Admin panel with permission-based access

### Registration Flow
1. User runs `/register` in registration channel
2. Modal appears collecting: name, country, age, birth date, income
3. User selects status (مدني/عصابة/فصيل)
4. If فصيل selected, user selects faction (شرطة/جيش/طب)
5. Request sent to admin channel for review
6. Admin approves or rejects

## Recent Changes
- **2025-11-06**: Project imported to Replit
  - Configured workflow for bot execution
  - Set up environment secrets (TOKEN, CLIENT_ID)
  - Installed dependencies (discord.js, dotenv)
  - Bot successfully running and connected to Discord

## Current State
The bot is fully operational and running. The workflow "discord-bot" automatically starts the bot using `node index.js`.

## Notes
- Database is file-based using JSON storage in `database/users.json`
- All UI messages are in Arabic
- Bot uses Discord.js v14 with slash commands and modals
- Permissions are role-based and configurable
- Registration requires admin approval
