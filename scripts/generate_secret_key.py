#!/usr/bin/env python
"""
Генератор SECRET_KEY для Flask приложения
"""
import secrets


def generate_secret_key(length=32):
    """Генерация криптографически безопасного ключа"""
    return secrets.token_hex(length)


if __name__ == '__main__':
    print("=" * 60)
    print("Генератор SECRET_KEY для Nebula Chat")
    print("=" * 60)
    print()
    print("Новый SECRET_KEY:")
    print(generate_secret_key())
    print()
    print("Скопируйте этот ключ в файл .env:")
    print("SECRET_KEY=<ваш_ключ>")
    print()
    print("⚠️  ВАЖНО: Никогда не публикуйте этот ключ!")
    print("=" * 60)
