import nodemailer from 'nodemailer';

export const createTransporter = (env: any) => {
  return nodemailer.createTransport({
    host: env.SMTP_HOST || process.env.SMTP_HOST,
    port: Number(env.SMTP_PORT || process.env.SMTP_PORT || 587),
    secure: Number(env.SMTP_PORT || process.env.SMTP_PORT) === 465,
    auth: {
      user: (env.SMTP_EMAIL || process.env.SMTP_EMAIL || '').replace(/"/g, ''),
      pass: (env.SMTP_PASS || process.env.SMTP_PASS || '').replace(/"/g, ''),
    },
  });
};

export const getFromEmail = (env: any) => {
  return (env.SMTP_FROM || process.env.SMTP_FROM || env.SMTP_EMAIL || process.env.SMTP_EMAIL || '').replace(/^"|"$/g, '');
};

export const sendAdminNotificationEmail = async (booking: any, env: any) => {
  try {
    const transporter = createTransporter(env);
    const fromEmail = getFromEmail(env);
    
    // We can pull the notification email from the database config, or fallback to fromEmail
    const adminEmail = booking.adminNotificationEmail || fromEmail;

    if (!adminEmail) {
      console.warn('No admin email configured for notifications.');
      return;
    }

    const subject = `New Quotation Request: ${booking.customer?.name} (${booking.id})`;
    const html = `
      <h2>New Quotation Request</h2>
      <p>A new quotation request has been submitted.</p>
      <ul>
        <li><strong>Ref ID:</strong> ${booking.id}</li>
        <li><strong>Customer:</strong> ${booking.customer?.name} (${booking.customer?.email} - ${booking.customer?.phone})</li>
        <li><strong>Origin:</strong> ${booking.journey?.origin}</li>
        <li><strong>Destination:</strong> ${booking.journey?.destination}</li>
        <li><strong>Date:</strong> ${booking.journey?.departureDate}</li>
        <li><strong>Passengers:</strong> ${booking.journey?.passengers}</li>
      </ul>
      <p>Log in to the Admin Dashboard to review and send the quote.</p>
    `;

    await transporter.sendMail({
      from: fromEmail,
      to: adminEmail,
      subject,
      html,
    });
    console.log('Admin notification email sent for booking:', booking.id);
  } catch (error) {
    console.error('Failed to send admin notification email:', error);
  }
};

export const sendQuotationEmail = async (booking: any, env: any) => {
  try {
    const transporter = createTransporter(env);
    const fromEmail = getFromEmail(env);
    const toEmail = booking.customer?.email;

    if (!toEmail) {
      console.warn('No customer email provided for quotation.');
      return;
    }

    const fare = booking.quote?.result?.finalPrice || booking.quote?.result?.finalFare || 0;
    const currency = '£';

    const subject = `Your Quotation from Carolean Coaches (${booking.id})`;
    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; border: 1px solid #e5e7eb; border-radius: 8px;">
        <h2 style="color: #1e293b;">Your Quotation Request</h2>
        <p>Dear ${booking.customer?.name},</p>
        <p>Thank you for requesting a quotation. Here are the details for your upcoming journey:</p>
        
        <div style="background-color: #f8fafc; padding: 15px; border-radius: 6px; margin: 20px 0;">
          <ul style="list-style: none; padding: 0; margin: 0;">
            <li style="margin-bottom: 10px;"><strong>Reference:</strong> ${booking.id}</li>
            <li style="margin-bottom: 10px;"><strong>Pickup:</strong> ${booking.journey?.origin}</li>
            <li style="margin-bottom: 10px;"><strong>Drop-off:</strong> ${booking.journey?.destination}</li>
            <li style="margin-bottom: 10px;"><strong>Date:</strong> ${booking.journey?.departureDate}</li>
            <li style="margin-bottom: 10px;"><strong>Passengers:</strong> ${booking.journey?.passengers}</li>
          </ul>
        </div>
        
        <div style="text-align: center; margin: 30px 0;">
          <span style="font-size: 14px; color: #64748b; text-transform: uppercase; letter-spacing: 1px;">Estimated Fare</span><br/>
          <span style="font-size: 32px; font-weight: bold; color: #dc2626;">${currency}${Number(fare).toFixed(2)}</span>
        </div>
        
        <p>If you have any questions or would like to proceed with this booking, please reply to this email or contact our support team.</p>
        <p>Best regards,<br/>Carolean Coaches Team</p>
      </div>
    `;

    await transporter.sendMail({
      from: fromEmail,
      to: toEmail,
      subject,
      html,
    });
    console.log('Customer quotation email sent for booking:', booking.id);
  } catch (error) {
    console.error('Failed to send customer quotation email:', error);
  }
};
