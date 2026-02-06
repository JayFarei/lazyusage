"""Setup script for usage CLI."""

from setuptools import setup, find_packages

setup(
    name='usage-cli',
    version='1.0.0',
    description='Usage monitoring CLI for Claude and Codex',
    author='Jay Farei',
    author_email='fareiunastrage@gmail.com',
    packages=find_packages(),
    install_requires=[
        'click>=8.0',
        'rich>=13.0',
        'textual>=0.47.0',
        'python-dateutil>=2.8.0',
    ],
    entry_points={
        'console_scripts': [
            'usage-check=src.cli:usage_check_main',
            'usage=src.cli:usage_main',
        ],
    },
    python_requires='>=3.8',
    classifiers=[
        'Development Status :: 4 - Beta',
        'Environment :: Console',
        'Intended Audience :: Developers',
        'License :: OSI Approved :: MIT License',
        'Programming Language :: Python :: 3',
        'Programming Language :: Python :: 3.8',
        'Programming Language :: Python :: 3.9',
        'Programming Language :: Python :: 3.10',
        'Programming Language :: Python :: 3.11',
        'Programming Language :: Python :: 3.12',
        'Topic :: Utilities',
    ],
)
