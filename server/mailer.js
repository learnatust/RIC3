// mailer.js
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  service: 'gmail', // or your email service
  auth: {
    user: 'ustfyp5@gmail.com', // Replace with your email
    pass: 'lraawqwplhserzsf', // Replace with your email password or app password
  },
});

const sendEmail = (to, subject, html) => {
  const mailOptions = {
    from: 'ustfyp5@gmail.com', // Replace with your email
    to,
    subject,
    html,
  };

  transporter.sendMail(mailOptions, (error, info) => {
    if (error) {
      console.log('Error sending email:', error);
    } else {
      console.log('Email sent:', info.response);
    }
  });
};

module.exports = sendEmail;
