export default {
  routes: [
    {
      method: 'POST',
      path: '/auth/magic-link/send',
      handler: 'magic-link.send',
      config: {
       auth: false,
       policies: [],
       middlewares: ['plugin::users-permissions.rateLimit'],
      },
    },
    {
      method: 'POST',
      path: '/auth/magic-link/verify',
      handler: 'magic-link.verify',
      config: {
       auth: false,
       policies: [],
       middlewares: ['plugin::users-permissions.rateLimit'],
      },
    }
  ],
};
