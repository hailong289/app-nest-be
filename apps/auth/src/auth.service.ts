import { Injectable } from '@nestjs/common';

@Injectable()
export class AuthService {
  private users = [
    { id: 1, email: 'admin@example.com', password: 'admin123', name: 'Admin User' },
    { id: 2, email: 'user@example.com', password: 'user123', name: 'Regular User' },
  ];

  async login(loginDto: { email: string; password: string }) {
    console.log('Login attempt:', loginDto);
    const user = this.users.find(
      u => u.email === loginDto.email && u.password === loginDto.password
    );

    if (!user) {
      return { success: false, message: 'Invalid credentials' };
    }

    // Simulate JWT token generation
    const token = `jwt_token_${user.id}_${Date.now()}`;
    
    return {
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }

  async register(registerDto: { email: string; password: string; name: string }) {
    const existingUser = this.users.find(u => u.email === registerDto.email);
    
    if (existingUser) {
      return { success: false, message: 'User already exists' };
    }

    const newUser = {
      id: this.users.length + 1,
      email: registerDto.email,
      password: registerDto.password,
      name: registerDto.name,
    };

    this.users.push(newUser);

    return {
      success: true,
      message: 'User registered successfully',
      user: {
        id: newUser.id,
        email: newUser.email,
        name: newUser.name,
      },
    };
  }

  async validateToken(token: string) {
    // Simple token validation (in real app, use JWT library)
    if (token && token.startsWith('jwt_token_')) {
      const userId = parseInt(token.split('_')[2]);
      const user = this.users.find(u => u.id === userId);
      
      if (user) {
        return {
          valid: true,
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
          },
        };
      }
    }

    return { valid: false };
  }

  async getUser(userId: number) {
    const user = this.users.find(u => u.id === userId);
    
    if (!user) {
      return { success: false, message: 'User not found' };
    }

    return {
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
      },
    };
  }
}