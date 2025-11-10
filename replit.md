# Discord Bank Bot

## Overview
A Discord bot that manages a virtual banking system with Arabic UI. Users can register accounts, transfer funds, check balances, and admins can manage accounts through a comprehensive admin panel.

## Project Details
- **Language**: Node.js (JavaScript)
- **Main Framework**: discord.js v14
- **Database**: File-based JSON storage
- **Language Support**: Arabic (UI and messages)

## Architecture

### How Everything Connects

The bot follows a modular architecture where **`index.js`** is the central orchestrator:

```
index.js (Main Hub)
├── Commands (./commands/*.js)
│   ├── register.js → Shows registration modal
│   ├── account.js → Displays user balance/info
│   ├── transfer.js → Handles money transfers
│   ├── withdraw.js → Processes withdrawals
│   ├── rank.js → Shows available ranks
│   ├── admin.js → Admin control panel
│   ├── reglist.js → Registration statistics
│   ├── setup.js → Per-guild configuration
│   └── support.js → Support ticket system
│
├── Configuration & Permissions
│   ├── guildConfig.js → Per-guild settings (multi-server support)
│   ├── guildConfigs.json → Stored guild configurations
│   ├── config.json → Default configuration template
│   └── permissions.json → Role-based permission mapping
│
├── Data Persistence
│   ├── database/users.json → User accounts & balances
│   └── database/transactions.json → Transaction history
│
└── Google Sheets Integration (Optional)
    └── sheets.js → Real-time sync with Google Sheets
```

### Core Files

**Main Entry Point:**
- `index.js` - Central orchestrator that:
  - Loads all command modules from `./commands/`
  - Handles all Discord interactions (slash commands, buttons, modals, select menus)
  - Provides helper functions to commands: `loadUsers()`, `saveUsers()`, `pushTx()`, `updateRegList()`, `pushLog()`
  - Enforces permissions using `hasPermission()` with data from `permissions.json`
  - Manages registration flow with multi-step modals and selects
  - Syncs data to Google Sheets (if configured)

**Configuration Management:**
- `guildConfig.js` - Per-guild configuration accessor
  - Exports: `get(guildId)`, `set(guildId, config)`, `patch(guildId, updates)`
  - Allows multi-server bot deployment with separate settings per server
  - Falls back to `config.json` defaults
- `permissions.json` - Role-based permissions for admin actions
  - Maps role IDs to permissions: approve, reject, addBalance, editInfo, editFee, etc.

**Data Layer:**
- `database/users.json` - User data storage (auto-created)
- `database/transactions.json` - Transaction log (auto-created)
- `sheets.js` - Optional Google Sheets integration
  - Safely wrapped: if unavailable, bot uses no-op methods
  - Syncs users and transactions in real-time
  - Auto-creates "Users" and "Transactions" sheets

**Command Registration:**
- `deploy-commands.js` - Registers slash commands with Discord API
  - Must be run when commands are added/modified
  - Supports both guild-specific (instant) and global deployment (1 hour)

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
- **2025-11-10**: Complete integration and error fixes
  - Fixed all interaction timeout errors by adding `deferUpdate()` and `deferReply()` for long-running operations
  - Replaced all deprecated `ephemeral: true` with `flags: 64` across all files
  - Updated event handler from `ready` to `clientReady` for Discord.js v14 compatibility
  - Implemented Google Sheets integration with auto-sheet creation
  - Added per-guild configuration system for multi-server support
  - Added comprehensive Edit Info feature for admins
  - Documented complete architecture showing how all components connect

- **2025-11-06**: Project imported to Replit
  - Configured workflow for bot execution
  - Set up environment secrets (TOKEN, CLIENT_ID, GOOGLE_CLIENT_EMAIL, GOOGLE_PRIVATE_KEY, SHEET_ID)
  - Installed dependencies (discord.js, dotenv, googleapis)
  - Bot successfully running and connected to Discord

## Current State
The bot is fully operational with all components properly connected:
- ✅ All files integrated and working together
- ✅ Google Sheets sync enabled (optional, gracefully degrades if unavailable)
- ✅ Multi-server support via per-guild configuration
- ✅ All interaction timeouts fixed
- ✅ No deprecation warnings
- ✅ Complete permission system active
- ✅ Workflow "discord-bot" auto-starts with `node index.js`

## Notes
- Database is file-based using JSON storage in `database/users.json`
- All UI messages are in Arabic
- Bot uses Discord.js v14 with slash commands and modals
- Permissions are role-based and configurable
- Registration requires admin approval
