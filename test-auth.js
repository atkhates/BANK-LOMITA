require('dotenv').config();
const { google } = require('googleapis');

(async () => {
  try {
    console.log('Testing Google Sheets authentication...\n');
    
    const email = process.env.GOOGLE_CLIENT_EMAIL;
    const rawKey = process.env.GOOGLE_PRIVATE_KEY || '';
    const sheetId = process.env.SHEET_ID;
    
    console.log('✓ Client email:', email ? email : '❌ MISSING');
    console.log('✓ Sheet ID:', sheetId ? sheetId : '❌ MISSING');
    console.log('✓ Private key length:', rawKey.length);
    console.log('✓ Key has BEGIN marker:', rawKey.includes('BEGIN PRIVATE KEY'));
    console.log('✓ Key has END marker:', rawKey.includes('END PRIVATE KEY'));
    
    let privateKey = rawKey.replace(/\\n/g, '\n');
    console.log('✓ After newline replacement:', privateKey.split('\n').length, 'lines\n');
    
    if (!privateKey.includes('\n')) {
      console.log('⚠️ No actual newlines found, trying different approach...');
      privateKey = rawKey;
    }
    
    console.log('Creating JWT auth...');
    const auth = new google.auth.JWT(
      email,
      null,
      privateKey,
      ['https://www.googleapis.com/auth/spreadsheets']
    );
    
    console.log('Attempting to authorize...');
    await auth.authorize();
    console.log('✅ Authorization successful!\n');
    
    console.log('Testing Sheets API access...');
    const sheets = google.sheets({ version: 'v4', auth });
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: 'Users!A1:Z1',
    });
    
    console.log('✅ SUCCESS! Header row:', res.data.values?.[0] || '(empty sheet)');
    
  } catch (e) {
    console.error('\n❌ Error:', e.message);
    if (e.response?.data) {
      console.error('Response data:', JSON.stringify(e.response.data, null, 2));
    }
  }
})();
