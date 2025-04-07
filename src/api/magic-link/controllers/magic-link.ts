import { Context } from 'koa';

export default {
  async send(ctx: Context): Promise<any> {
    const { email } = ctx.request.body as { email?: string };

    if (!email) {
      return ctx.badRequest('Email is required');
    }

    // Find or create user
    let user = await strapi.query('plugin::users-permissions.user').findOne({
      where: { email }
    });

    if (!user) {
      // Auto-create user with this email
      console.log('Creating new user with email:', email);
      const defaultRole = await strapi.query('plugin::users-permissions.role').findOne({
        where: { type: 'authenticated' }
      });

      user = await strapi.entityService.create('plugin::users-permissions.user', {
        data: {
          email,
          username: email,
          confirmed: true,
          provider: 'local',
          password: Math.random().toString(36).slice(-8), // Random password
          role: defaultRole.id
        }
      });
      console.log('New user created:', user);
    }
    // Generate short-lived JWT (15 minutes)
    const token = strapi.plugins['users-permissions'].services.jwt.issue(
      { id: user.id },
      { expiresIn: '15m' }
    );
    // Create magic link URL
    const magicLinkUrl = `${process.env.FRONTEND_URL}/auth/verify?token=${token}`;
    console.log('Magic link URL:', magicLinkUrl);

    if (process.env.NODE_ENV === 'development' || process.env.EMAIL_BYPASS === 'true') {
      console.log('DEVELOPMENT MODE: Bypassing email sending');
      console.log('Magic Link:', magicLinkUrl);

      // Return the token directly in development mode
      return {
        message: 'Development mode: Magic link generated',
        magicLink: magicLinkUrl
      };
    }

    // Send email
    try {
      await strapi.plugins['email'].services.email.send({
        from: process.env.SMTP_FROM || 'noreply@gmail.com',
        to: email,
        subject: 'Your Canvas Access Link',
        html: `<p>Click the link below to access the collaborative canvas:</p>
               <p><a href="${magicLinkUrl}">Access Canvas</a></p>
               <p>This link will expire in 15 minutes.</p>`,
      });

      return { message: 'Access link sent successfully' };
    } catch (error) {
      console.error('Failed to send email:', error);
      return ctx.badRequest('Failed to send email');
    }
  },

  async verify(ctx: Context): Promise<any> {

    console.log('Verifying magic link...');
    const { token } = ctx.request.body as { token?: string };

    if (!token) {
      console.error('Token is required');
      return ctx.badRequest('Token is required');
    }

    try {
      // Verify JWT
      const decoded = await strapi.plugins['users-permissions'].services.jwt.verify(token);
      console.log('Decoded token:', decoded);

      const { id } = decoded as { id: number };

      if (!id) {
        console.error('Invalid token - no ID found');
        return ctx.badRequest('Invalid token');
      }

      // Find the user
      const user = await strapi.entityService.findOne('plugin::users-permissions.user', id);

      if (!user) {
        console.error('User not found with ID:', id);
        return ctx.badRequest('Invalid token');
      }

      // Generate regular session JWT
      const jwt = strapi.plugins['users-permissions'].services.jwt.issue({ id: user.id });
      console.log('Generated JWT for user ID:', user.id);

      const { password, resetPasswordToken, confirmationToken, ...safeUserData } = user;


      return {
        jwt,
        user: safeUserData,
      };
    } catch (error) {
      console.error('Token verification error:', error);
      return ctx.badRequest('Invalid or expired token');
    }
  },
};
