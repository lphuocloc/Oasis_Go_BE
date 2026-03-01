const nodemailer = require("nodemailer");

// Tạo transporter để gửi email
const createTransporter = () => {
  return nodemailer.createTransport({
    service: process.env.EMAIL_SERVICE || "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASSWORD,
    },
  });
};

// Generate OTP 6 chữ số
const generateOTP = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Gửi OTP qua email
const sendOTPEmail = async (email, otp) => {
  try {
    const transporter = createTransporter();

    const mailOptions = {
      from: `"${process.env.APP_NAME || "Your App"}" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: "Verify Your Email - OTP Code",
      html: `
                <!DOCTYPE html>
                <html>
                <head>
                    <style>
                        body {
                            font-family: Arial, sans-serif;
                            line-height: 1.6;
                            color: #333;
                        }
                        .container {
                            max-width: 600px;
                            margin: 0 auto;
                            padding: 20px;
                            background-color: #f9f9f9;
                        }
                        .header {
                            background-color: #4CAF50;
                            color: white;
                            padding: 20px;
                            text-align: center;
                            border-radius: 5px 5px 0 0;
                        }
                        .content {
                            background-color: white;
                            padding: 30px;
                            border-radius: 0 0 5px 5px;
                        }
                        .otp-box {
                            background-color: #f0f0f0;
                            border: 2px dashed #4CAF50;
                            padding: 20px;
                            text-align: center;
                            margin: 20px 0;
                            border-radius: 5px;
                        }
                        .otp-code {
                            font-size: 32px;
                            font-weight: bold;
                            color: #4CAF50;
                            letter-spacing: 5px;
                        }
                        .footer {
                            text-align: center;
                            margin-top: 20px;
                            color: #777;
                            font-size: 12px;
                        }
                        .warning {
                            color: #ff6b6b;
                            font-weight: bold;
                            margin-top: 15px;
                        }
                    </style>
                </head>
                <body>
                    <div class="container">
                        <div class="header">
                            <h1>Email Verification</h1>
                        </div>
                        <div class="content">
                            <h2>Hello!</h2>
                            <p>Thank you for registering with us. To complete your registration, please use the following OTP code:</p>
                            
                            <div class="otp-box">
                                <p style="margin: 0; color: #666;">Your OTP Code</p>
                                <div class="otp-code">${otp}</div>
                            </div>
                            
                            <p><strong>This code will expire in 5 minutes.</strong></p>
                            
                            <p>If you didn't request this code, please ignore this email or contact support if you have concerns.</p>
                            
                            <p class="warning">⚠️ Never share this code with anyone!</p>
                        </div>
                        <div class="footer">
                            <p>This is an automated email. Please do not reply.</p>
                            <p>&copy; ${new Date().getFullYear()} ${process.env.APP_NAME || "Your App"}. All rights reserved.</p>
                        </div>
                    </div>
                </body>
                </html>
            `,
    };

    const info = await transporter.sendMail(mailOptions);
    console.log("OTP Email sent:", info.messageId);
    return true;
  } catch (error) {
    console.error("Error sending OTP email:", error);
    throw new Error("Failed to send OTP email");
  }
};

module.exports = {
  generateOTP,
  sendOTPEmail,
};
