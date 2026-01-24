const swaggerJsdoc = require('swagger-jsdoc');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'Oasis Go API',
            version: '1.0.0',
            description: 'API documentation for Oasis Go backend with JWT authentication',
            contact: {
                name: 'Oasis Go Team',
                email: 'support@oasisgo.com'
            }
        },
        servers: [
            {
                url: 'http://localhost:3000',
                description: 'Development server'
            },
            {
                url: 'https://api.oasisgo.com',
                description: 'Production server'
            }
        ],
        components: {
            securitySchemes: {
                bearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'Enter your JWT token'
                }
            },
            schemas: {
                User: {
                    type: 'object',
                    properties: {
                        id: {
                            type: 'string',
                            description: 'User ID'
                        },
                        email: {
                            type: 'string',
                            format: 'email',
                            description: 'User email address'
                        },
                        name: {
                            type: 'string',
                            description: 'User full name'
                        },
                        role: {
                            type: 'string',
                            enum: ['user', 'admin', 'driver'],
                            description: 'User role'
                        },
                        authProvider: {
                            type: 'string',
                            enum: ['local', 'google'],
                            description: 'Authentication provider'
                        },
                        avatar: {
                            type: 'string',
                            nullable: true,
                            description: 'User avatar URL'
                        },
                        createdAt: {
                            type: 'string',
                            format: 'date-time',
                            description: 'Account creation date'
                        }
                    }
                },
                AuthResponse: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean'
                        },
                        message: {
                            type: 'string'
                        },
                        data: {
                            type: 'object',
                            properties: {
                                user: {
                                    $ref: '#/components/schemas/User'
                                },
                                token: {
                                    type: 'string',
                                    description: 'JWT access token'
                                }
                            }
                        }
                    }
                },
                Error: {
                    type: 'object',
                    properties: {
                        success: {
                            type: 'boolean',
                            example: false
                        },
                        message: {
                            type: 'string',
                            description: 'Error message'
                        },
                        authProvider: {
                            type: 'string',
                            description: 'Auth provider (if relevant)'
                        }
                    }
                }
            }
        },
        security: [
            {
                bearerAuth: []
            }
        ]
    },
    apis: ['./src/routes/*.js'] // Path to API routes
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
