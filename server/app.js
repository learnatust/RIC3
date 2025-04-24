// app.js
const express = require('express');
const cors = require('cors');
const connectDB = require('./db');
const Address = require('./models/Address');
const sendEmail = require('./mailer');

const app = express();
app.use(express.json());
app.use(cors())

connectDB();

app.post('/check-address', async (req, res) => {
  let { address, txDetail } = req.body; 
  address = address.toLowerCase();
  txDetail = JSON.parse(txDetail);

  try {
    const addressRecord = await Address.findOne({ address });

    if (addressRecord) {
      // If a match is found, send an email
      sendEmail(
        addressRecord.email,
        'Inflow of illicit funds',
        `<p>Inflow of illicit funds to platform found<br/><b>Transaction hash</b>: <a href="https://sepolia.etherscan.io/tx/${txDetail.txHash}">${txDetail.txHash}</a><br/><b>From</b>: ${txDetail.from}<br/><b>To</b>: ${txDetail.to}<br/><b>Amount</b>: ${txDetail.amount}</p>`
      );
      res.status(200).json({ message: 'Match found and email sent.' });
    } else {
      // If no match is found, continue listening
      res.status(200).json({ message: 'No match found.' });
    }
  } catch (err) {
    console.error('Error searching for address:', err);
    res.status(500).json({ message: 'Internal server error.' });
  }
});

const PORT = process.env.PORT || 4500;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});