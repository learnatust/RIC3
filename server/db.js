// db.js
const mongoose = require('mongoose');

const connectDB = async () => {
  try {
    const dbPassword = encodeURIComponent('fyt20020308'); // Replace with your actual password
    const dbURI = `mongodb+srv://fu879435613:${dbPassword}@cluster0.chlcq.mongodb.net/FYP_ethereumDB?retryWrites=true&w=majority`;

    await mongoose.connect(dbURI);
    console.log('MongoDB Atlas connected');
  } catch (err) {
    console.error('MongoDB Atlas connection error:', err);
    process.exit(1);
  }
};

module.exports = connectDB;