// models/Address.js
const mongoose = require('mongoose');

const addressSchema = new mongoose.Schema({
  address: {
    type: String,
    required: true,
    unique: true,
  },
  email: {
    type: String,
    required: true,
  },
});

module.exports = mongoose.model('Address', addressSchema, 'ethereumDB_samples');