const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  host:   process.env.SMTP_HOST,
  port:   parseInt(process.env.SMTP_PORT || '587'),
  secure: process.env.SMTP_SECURE === 'true',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
})

async function sendMfaCode(toEmail, code) {
  await transporter.sendMail({
    from:    process.env.SMTP_FROM,
    to:      toEmail,
    subject: 'Your SimplerFinance login code',
    text:    `Your login code is: ${code}\n\nThis code expires in 10 minutes.\n\nIf you did not request this code, someone may be trying to access your account.`,
  })
}

async function sendRegistrationCode(toEmail, code) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Verify your SimplerFinance email',
    text: `Your account verification code is: ${code}\n\nThis code expires in 10 minutes. Your account will remain inactive until the code is verified.\n\nIf you did not create this account, you can ignore this email.`,
  });
}

async function sendEmailChangeCode(toEmail, code) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Verify your new SimplerFinance email',
    text: `Your email change verification code is: ${code}\n\nThis code expires in 10 minutes. Your login email will not change until this code is verified.\n\nIf you did not request this change, do not share this code.`,
  });
}

async function sendPasswordResetCode(toEmail, code) {
  await transporter.sendMail({
    from: process.env.SMTP_FROM,
    to: toEmail,
    subject: 'Reset your SimplerFinance password',
    text: `Your password reset code is: ${code}\n\nThis code expires in 10 minutes. Your password has not been changed yet.\n\nIf you did not request this, do not share the code and change your password from a signed-in device.`,
  });
}

module.exports = { sendEmailChangeCode, sendMfaCode, sendPasswordResetCode, sendRegistrationCode }
