"""Setup script for usage CLI."""

from setuptools import setup, find_packages

setup(
    name='usage-cli',
    version='1.0.0',
    description='Usage monitoring CLI for Claude and Codex',
    author='Jay Farei',
    packages=find_packages(),
    install_requires=[
        'click>=8.0',
        'rich>=13.0',
        'python-dateutil>=2.8.0',
    ],
    entry_points={
        'console_scripts': [
            'usage=src.cli:main',
        ],
    },
    python_requires='>=3.8',
)
