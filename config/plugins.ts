export default ({env}) => ({
        'strapi-realtime-canvas-provider': {
        enabled: true,
        // resolve: './packages/strapi-realtime-canvas-provider'
      },
    email: {
        config: {
            provider: 'sendmail',
            providerOptions: {
                host: env('SMTP_HOST', 'smtp.canvas.com'),
                port: env.int('SMTP_PORT', 587),
                auth: {
                    user: env('SMTP_USERNAME'),
                    pass: env('SMTP_PASSWORD'),
                },
                secure: env.bool('SMTP_SECURE', false),
            },
            settings: {
                defaultFrom: env('SMTP_FROM', 'canvas@example.com'),
                defaultReplyTo: env('SMTP_REPLY_TO', 'canvas@example.com'),
            },
        },
    },
});
