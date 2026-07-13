import { Body, Controller, Get, Post, UseGuards } from "@nestjs/common";
import { IsEmail, IsString, MinLength } from "class-validator";
import { AuthService } from "./auth.service";
import { AuthUser, CurrentUser, JwtAuthGuard } from "../../common/auth.guard";
import { RateLimit, RateLimitGuard } from "../../common/rate-limit.guard";

class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;
}

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post("login")
  @UseGuards(RateLimitGuard)
  @RateLimit({ limit: 5, windowSec: 60 })
  login(@Body() dto: LoginDto) {
    return this.auth.login(dto.email, dto.password);
  }

  @Get("me")
  @UseGuards(JwtAuthGuard)
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
