# CULT DAO Hub

A community-built, open-source interface for interacting with the CULT DAO ecosystem. This hub is a comprehensive, transparent, and user-friendly dashboard for all members of the DAO, from Guardians to The Many.

> The goal is to provide tools that empower the community, increase transparency, and give every member the ability to easily track and participate in the governance of the DAO.

### Features

*   **Complete Wallet Management:** Connect your wallet for a full breakdown of your CULT and dCULT holdings, delegation status, and on-chain voting rights.
*   **Seamless Staking & Rewards:** A simple, unified interface to stake CULT, unstake dCULT, and claim your accumulated rewards from DAO investments with a single click.
*   **Full DAO Governance Suite:** View active, pending, and past proposals with a powerful search and filter function. Guardians can submit new proposals, and The Many can cast their votes directly on-chain or via gasless signature.
*   **In-Depth DAO Metrics:** A detailed, real-time dashboard tracking key on-chain statistics, including token supply dynamics (total, circulating, burned), treasury value, liquidity pools, and market data.
*   **Advanced Wallet Tracking:** Add multiple Ethereum addresses or ENS names to a persistent watchlist to monitor combined holdings and delegation statuses—perfect for managing your own wallets.
*   **Multi-Currency & Theme Support:** View all financial data in your preferred global currency (USD, EUR, BTC, etc.). Customize your experience with multiple visual themes and a "shuffle" mode for a unique look every time.

**Disclaimer & Terms of Use:** This is a community-built tool and is **NOT the official CULT DAO website.** While this software has been thoroughly tested, its use is entirely at your own risk. By using this application, you are interacting directly with the immutable CULT DAO smart contracts on the Ethereum blockchain. You are solely responsible for the security of your wallet and for any transactions you approve. This software is provided "AS IS", without warranty of any kind.

## Running Locally

This project is designed to be run easily on your local machine without any complex setup.

### Prerequisites

You need **Python 3** installed on your computer.
*   **macOS / Linux:** Python 3 is usually pre-installed.
*   **Windows:** If you don't have it, you can get it from the [official Python website](https://www.python.org/downloads/). During installation, make sure to check the box that says "Add Python to PATH".

### Easiest Method (No Git Required)

1.  **Download the Code:**
    *   Go to the main page of this GitHub repository.
    *   Click the green **`< > Code`** button, then select **`Download ZIP`**.
    *   Unzip the downloaded file (e.g., `hub-main.zip`) on your computer.

2.  **Open Your Terminal:**
    *   **On Mac:** Open the "Terminal" application.
    *   **On Windows:** Open "Command Prompt" or "PowerShell".

3.  **Navigate to the Folder:**
    *   Type `cd ` (that's `c`, `d`, and a space) into your terminal.
    *   **Do not press Enter yet.**
    *   Drag the unzipped project folder from your file manager (Finder/Windows Explorer) directly onto the terminal window. The correct path will be automatically pasted.
    *   Now, press **Enter**. Your terminal is now inside the project folder.

4.  **Start the Server:**
    *   In the terminal, type the command for your system and press **Enter**:
        *   **Mac / Linux:** `python3 -m http.server`
        *   **Windows:** `python -m http.server`

5.  **View in Browser:**
    *   The terminal will display a message like `Serving HTTP on port 8000...`.
    *   Open your web browser and go to the following address:
        [**http://localhost:8000**](http://localhost:8000)

The application is now running on your machine!

---

### Alternative for Developers (Git)

If you have Git installed, you can clone the repository for easier updates:

```bash
# Clone the repository
git clone https://github.com/wearecultdao/hub.git

# Navigate into the directory
cd hub

# Start the server (use 'python' on Windows)
python3 -m http.server
