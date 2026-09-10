 const BLACK = "B";
      const WHITE = "W";
      const EMPTY = "E";

      let board = [];
      let turn = BLACK;
      let p1Name = "Player 1";
      let p2Name = "Player 2";
      let validMoves = [];
      let gameMode = "2player";
      let difficulty = "medium";
      let isAIThinking = false;

      const setupScreen = document.getElementById("setup-screen");
      const gameScreen = document.getElementById("game-screen");
      const startBtn = document.getElementById("start-btn");
      const restartBtn = document.getElementById("restart-btn");
      const boardEl = document.getElementById("board");
      const msgEl = document.getElementById("message");

      const scoreBlackEl = document.getElementById("score-black");
      const scoreWhiteEl = document.getElementById("score-white");
      const nameBlackEl = document.getElementById("name-black");
      const nameWhiteEl = document.getElementById("name-white");
      const cardBlack = document.getElementById("card-black");
      const cardWhite = document.getElementById("card-white");

      const directions = [
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, -1],
        [0, 1],
        [1, -1],
        [1, 0],
        [1, 1],
      ];

      document
        .getElementById("game-mode")
        .addEventListener("change", function () {
          const difficultyGroup = document.getElementById("difficulty-group");
          if (this.value === "1player") {
            difficultyGroup.classList.remove("hidden");
            document.getElementById("player2-group").classList.add("hidden");
          } else {
            difficultyGroup.classList.add("hidden");
            document.getElementById("player2-group").classList.remove("hidden");
          }
        });

      startBtn.addEventListener("click", () => {
        gameMode = document.getElementById("game-mode").value;
        difficulty = document.getElementById("difficulty").value;

        if (gameMode === "1player") {
          p1Name =
            document.getElementById("player1").value.trim() || "Player 1";
          p2Name = "AndI";
        } else {
          p1Name =
            document.getElementById("player1").value.trim() || "Player 1";
          p2Name =
            document.getElementById("player2").value.trim() || "Player 2";
        }

        nameBlackEl.textContent = p1Name;
        nameWhiteEl.textContent = p2Name;
        setupScreen.classList.add("hidden");
        gameScreen.classList.remove("hidden");
        initGame();
      });

      restartBtn.addEventListener("click", () => {
        restartBtn.classList.add("hidden");
        initGame();
      });

      function initGame() {
        board = Array(8)
          .fill(null)
          .map(() => Array(8).fill(EMPTY));

        board[3][3] = WHITE;
        board[3][4] = BLACK;
        board[4][3] = BLACK;
        board[4][4] = WHITE;

        turn = BLACK;
        msgEl.textContent = "";
        isAIThinking = false;

        buildRenderHTMLBoard();
        updateGameCycleState();
      }

      function buildRenderHTMLBoard() {
        boardEl.innerHTML = "";
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const cell = document.createElement("div");
            cell.classList.add("cell");
            cell.dataset.row = r;
            cell.dataset.col = c;
            cell.addEventListener("click", handleCellClick);
            boardEl.appendChild(cell);
          }
        }
      }

      function handleCellClick(e) {
        if (isAIThinking) return;
        const r = parseInt(e.currentTarget.dataset.row);
        const c = parseInt(e.currentTarget.dataset.col);
        const move = validMoves.find((m) => m.r === r && m.c === c);
        if (!move) return;

        executeMove(r, c, move.flips);
        turn = turn === BLACK ? WHITE : BLACK;
        updateGameCycleState();
      }

      function executeMove(row, col, flippingCoordinates) {
        board[row][col] = turn;
        flippingCoordinates.forEach(([r, c]) => {
          board[r][c] = turn;
        });
        renderDiscsAndHints();
      }

      function updateGameCycleState() {
        validMoves = getAllValidMoves(turn);
        if (validMoves.length === 0) {
          const nextPlayer = turn === BLACK ? WHITE : BLACK;
          const nextValidMoves = getAllValidMoves(nextPlayer);
          if (nextValidMoves.length === 0) {
            renderDiscsAndHints();
            evaluateEndGame();
            return;
          } else {
            msgEl.textContent = `${turn === BLACK ? p1Name : p2Name} has no moves! Passing turn.`;
            turn = nextPlayer;
            validMoves = nextValidMoves;
            setTimeout(() => {
              msgEl.textContent = "";
            }, 2000);
          }
        }

        if (turn === BLACK) {
          cardBlack.classList.add("active");
          cardWhite.classList.remove("active");
        } else {
          cardWhite.classList.add("active");
          cardBlack.classList.remove("active");
        }
        renderDiscsAndHints();

        if (gameMode === "1player" && turn === WHITE && validMoves.length > 0) {
          isAIThinking = true;
          msgEl.textContent = "AndI is thinking...";
          setTimeout(() => {
            const aiMove = getAIMove();
            if (aiMove) {
              executeMove(aiMove.r, aiMove.c, aiMove.flips);
              turn = turn === BLACK ? WHITE : BLACK;
              msgEl.textContent = "";
              isAIThinking = false;
              updateGameCycleState();
            } else {
              isAIThinking = false;
              msgEl.textContent = "";
              updateGameCycleState();
            }
          }, 2000);
        }
      }

      function renderDiscsAndHints() {
        let blackCount = 0;
        let whiteCount = 0;
        const cells = boardEl.children;
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            const cellIdx = r * 8 + c;
            const cellEl = cells[cellIdx];
            const piece = board[r][c];
            cellEl.innerHTML = "";
            cellEl.classList.remove("valid-move");
            if (piece === BLACK) {
              const disc = document.createElement("div");
              disc.classList.add("disc", "black");
              cellEl.appendChild(disc);
              blackCount++;
            } else if (piece === WHITE) {
              const disc = document.createElement("div");
              disc.classList.add("disc", "white");
              cellEl.appendChild(disc);
              whiteCount++;
            } else {
              const isMoveValid = validMoves.some(
                (m) => m.r === r && m.c === c,
              );
              if (isMoveValid) {
                cellEl.classList.add("valid-move");
              }
            }
          }
        }
        scoreBlackEl.textContent = blackCount;
        scoreWhiteEl.textContent = whiteCount;
      }

      function getAllValidMoves(playerColor) {
        let moves = [];
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (board[r][c] !== EMPTY) continue;
            let totalFlips = [];
            const opponent = playerColor === BLACK ? WHITE : BLACK;
            for (const [dr, dc] of directions) {
              let currentFlips = [];
              let nr = r + dr;
              let nc = c + dc;
              while (
                nr >= 0 &&
                nr < 8 &&
                nc >= 0 &&
                nc < 8 &&
                board[nr][nc] === opponent
              ) {
                currentFlips.push([nr, nc]);
                nr += dr;
                nc += dc;
              }
              if (
                nr >= 0 &&
                nr < 8 &&
                nc >= 0 &&
                nc < 8 &&
                board[nr][nc] === playerColor
              ) {
                if (currentFlips.length > 0) {
                  totalFlips = totalFlips.concat(currentFlips);
                }
              }
            }
            if (totalFlips.length > 0) {
              moves.push({ r, c, flips: totalFlips });
            }
          }
        }
        return moves;
      }

      function getAIMove() {
        const validMoves = getAllValidMoves(turn);
        if (validMoves.length === 0) return null;

        if (difficulty === "easy") {
          return validMoves[Math.floor(Math.random() * validMoves.length)];
        } else if (difficulty === "medium") {
          return validMoves.reduce((best, move) =>
            move.flips.length > best.flips.length ? move : best,
          );
        } else {
          return minimaxMove(validMoves, 3);
        }
      }

      function minimaxMove(validMoves, depth) {
        let bestMove = validMoves[0];
        let bestScore = -Infinity;
        const currentPlayer = turn;

        for (const move of validMoves) {
          const simulatedBoard = simulateMove(board, move, currentPlayer);
          const score = minimax(
            simulatedBoard,
            depth - 1,
            -Infinity,
            Infinity,
            false,
            currentPlayer,
          );
          if (score > bestScore) {
            bestScore = score;
            bestMove = move;
          }
        }
        return bestMove;
      }

      function minimax(
        boardState,
        depth,
        alpha,
        beta,
        isMaximizing,
        originalPlayer,
      ) {
        const currentTurn = isMaximizing
          ? originalPlayer
          : originalPlayer === BLACK
            ? WHITE
            : BLACK;
        const moves = getAllValidMovesForBoard(boardState, currentTurn);

        if (depth === 0 || moves.length === 0) {
          return evaluateBoard(boardState, originalPlayer);
        }

        if (isMaximizing) {
          let maxEval = -Infinity;
          for (const move of moves) {
            const newBoard = simulateMove(boardState, move, currentTurn);
            const evalScore = minimax(
              newBoard,
              depth - 1,
              alpha,
              beta,
              false,
              originalPlayer,
            );
            maxEval = Math.max(maxEval, evalScore);
            alpha = Math.max(alpha, evalScore);
            if (beta <= alpha) break;
          }
          return maxEval;
        } else {
          let minEval = Infinity;
          for (const move of moves) {
            const newBoard = simulateMove(boardState, move, currentTurn);
            const evalScore = minimax(
              newBoard,
              depth - 1,
              alpha,
              beta,
              true,
              originalPlayer,
            );
            minEval = Math.min(minEval, evalScore);
            beta = Math.min(beta, evalScore);
            if (beta <= alpha) break;
          }
          return minEval;
        }
      }

      function getAllValidMovesForBoard(boardState, playerColor) {
        let moves = [];
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (boardState[r][c] !== EMPTY) continue;
            let totalFlips = [];
            const opponent = playerColor === BLACK ? WHITE : BLACK;
            for (const [dr, dc] of directions) {
              let currentFlips = [];
              let nr = r + dr;
              let nc = c + dc;
              while (
                nr >= 0 &&
                nr < 8 &&
                nc >= 0 &&
                nc < 8 &&
                boardState[nr][nc] === opponent
              ) {
                currentFlips.push([nr, nc]);
                nr += dr;
                nc += dc;
              }
              if (
                nr >= 0 &&
                nr < 8 &&
                nc >= 0 &&
                nc < 8 &&
                boardState[nr][nc] === playerColor
              ) {
                if (currentFlips.length > 0) {
                  totalFlips = totalFlips.concat(currentFlips);
                }
              }
            }
            if (totalFlips.length > 0) {
              moves.push({ r, c, flips: totalFlips });
            }
          }
        }
        return moves;
      }

      function simulateMove(boardState, move, player) {
        const newBoard = boardState.map((row) => [...row]);
        newBoard[move.r][move.c] = player;
        move.flips.forEach(([r, c]) => {
          newBoard[r][c] = player;
        });
        return newBoard;
      }

      function evaluateBoard(boardState, player) {
        const opponent = player === BLACK ? WHITE : BLACK;
        let playerScore = 0;
        let opponentScore = 0;

        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (boardState[r][c] === player) playerScore++;
            if (boardState[r][c] === opponent) opponentScore++;
          }
        }
        return playerScore - opponentScore;
      }

      function evaluateEndGame() {
        cardBlack.classList.remove("active");
        cardWhite.classList.remove("active");
        let b = 0,
          w = 0;
        for (let r = 0; r < 8; r++) {
          for (let c = 0; c < 8; c++) {
            if (board[r][c] === BLACK) b++;
            if (board[r][c] === WHITE) w++;
          }
        }

        if (b > w) {
          msgEl.textContent = `🎉 ${p1Name} Wins! (${b} - ${w})`;
        } else if (w > b) {
          msgEl.textContent = `🎉 ${p2Name} Wins! (${w} - ${b})`;
        } else {
          msgEl.textContent = `🤝 Tie Game! (${b} - ${w})`;
        }
        restartBtn.classList.remove("hidden");
      }