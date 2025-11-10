require('dotenv').config();
const fs = require('fs');
const Sheets = require('./sheets');

(async () => {
  try {
    console.log('Loading users from database...');
    const users = JSON.parse(fs.readFileSync('./database/users.json', 'utf8'));
    console.log('Users found:', Object.keys(users).length);
    console.log('Users:', JSON.stringify(users, null, 2));
    
    console.log('\nAttempting to sync to Google Sheets...');
    await Sheets.syncUsers(users);
    console.log('✅ Sync successful!');
  } catch (e) {
    console.error('❌ Sync failed:', e.message);
    console.error(e);
  }
})();
