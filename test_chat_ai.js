const fetch = require('node-fetch');

async function test() {
  const url = 'https://fensjqscutikgccajwkh.supabase.co/functions/v1/chat-ai';
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        business_id: 'user_2hJ9XQvT0F5k9h7l1o6P8H9G4J2',
        message: 'Hello',
        history: [],
        is_greeting: false,
        session_id: 'test_session_id'
      })
    });
    console.log(res.status);
    const data = await res.text();
    console.log(data);
  } catch (err) {
    console.error(err);
  }
}
test();
