const http = require('http');

http.get('http://127.0.0.1:5000/api/bookings', (res) => {
  let data = '';
  res.on('data', chunk => data += chunk);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    if (res.statusCode !== 200) {
      console.log('Body:', data);
    } else {
      console.log('Body length:', data.length);
    }
  });
}).on('error', err => {
  console.log('Error:', err.message);
});
