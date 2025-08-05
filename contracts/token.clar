;; GovNet Governance Token with Staking, Delegation, Quadratic Voting, and Reputation
;; Clarity v2

;; Error codes
(define-constant ERR-NOT-AUTHORIZED u100)
(define-constant ERR-INSUFFICIENT-BALANCE u101)
(define-constant ERR-INSUFFICIENT-STAKE u102)
(define-constant ERR-SELF-DELEGATION u103)
(define-constant ERR-DELEGATION-CYCLE u104)
(define-constant ERR-ALREADY-DELEGATED u105)
(define-constant ERR-NOT-DELEGATED u106)
(define-constant ERR-PAUSED u107)
(define-constant ERR-ZERO-ADDRESS u108)

;; Token metadata
(define-constant TOKEN-NAME "GovNet Governance Token")
(define-constant TOKEN-SYMBOL "GOVT")
(define-constant TOKEN-DECIMALS u6)
(define-constant MAX-SUPPLY u1000000000) ;; 1B (decimals separate)

;; Admin and control
(define-data-var admin principal tx-sender)
(define-data-var paused bool false)
(define-data-var total-supply uint u0)

;; Balances
(define-map balances principal uint)
(define-map staked-balances principal uint)

;; Delegation: who you delegate to
(define-map delegation principal principal) ;; delegator -> delegatee

;; Reverse tally: accumulated delegated quadratic voting power to a delegatee
(define-map incoming-delegated principal uint)

;; Reputation per user
(define-map reputation principal uint)

;; Participation record
(define-map proposals-voted principal uint)

;; ========== PRIVATE HELPERS ==========

(define-private (is-admin)
  (is-eq tx-sender (var-get admin))
)

(define-private (ensure-not-paused)
  (asserts! (not (var-get paused)) (err ERR-PAUSED))
)

(define-private (get-balance (p principal))
  (default-to u0 (map-get? balances p))
)

(define-private (get-staked (p principal))
  (default-to u0 (map-get? staked-balances p))
)

(define-private (get-incoming-delegated (p principal))
  (default-to u0 (map-get? incoming-delegated p))
)

(define-private (sqrt-uint (x uint))
  ;; Integer square root via Babylonian method
  (if (<= x u1)
      x
      (let loop ((r x) (prev u0))
        (let ((next (floor (/ (+ r (floor (/ x r))) u2))))
          (if (or (is-eq next r) (is-eq next prev))
              r
              (loop next r))
        )
      )
  )
)

(define-private (increase-incoming (delegatee principal) (amount uint))
  (let ((curr (get-incoming-delegated delegatee)))
    (map-set incoming-delegated delegatee (+ curr amount))
  )
)

(define-private (decrease-incoming (delegatee principal) (amount uint))
  (let ((curr (get-incoming-delegated delegatee)))
    (map-set incoming-delegated delegatee (if (>= curr amount) (- curr amount) u0))
  )
)

;; ========== ADMIN ACTIONS ==========

(define-public (transfer-admin (new-admin principal))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq new-admin 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (var-set admin new-admin)
    (ok true)
  )
)

(define-public (set-paused (p bool))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (var-set paused p)
    (ok p)
  )
)

(define-public (mint (recipient principal) (amount uint))
  (begin
    (asserts! (is-admin) (err ERR-NOT-AUTHORIZED))
    (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (let ((new-supply (+ (var-get total-supply) amount)))
      (asserts! (<= new-supply MAX-SUPPLY) (err ERR-INSUFFICIENT-BALANCE))
      (let ((prev (get-balance recipient)))
        (map-set balances recipient (+ prev amount))
        (var-set total-supply new-supply)
        (ok true)
      )
    )
  )
)

;; ========== TOKEN OPERATIONS ==========

(define-public (transfer (recipient principal) (amount uint))
  (begin
    (ensure-not-paused)
    (asserts! (not (is-eq recipient 'SP000000000000000000002Q6VF78)) (err ERR-ZERO-ADDRESS))
    (let ((sender-balance (get-balance tx-sender)))
      (asserts! (>= sender-balance amount) (err ERR-INSUFFICIENT-BALANCE))
      (map-set balances tx-sender (- sender-balance amount))
      (let ((dest-balance (get-balance recipient)))
        (map-set balances recipient (+ dest-balance amount)))
      (ok true)
    )
  )
)

(define-public (burn (amount uint))
  (begin
    (ensure-not-paused)
    (let ((bal (get-balance tx-sender)))
      (asserts! (>= bal amount) (err ERR-INSUFFICIENT-BALANCE))
      (map-set balances tx-sender (- bal amount))
      (var-set total-supply (- (var-get total-supply) amount))
      (ok true)
    )
  )
)

;; ========== STAKING ==========

(define-public (stake (amount uint))
  (begin
    (ensure-not-paused)
    (let ((bal (get-balance tx-sender)))
      (asserts! (>= bal amount) (err ERR-INSUFFICIENT-BALANCE))
      (map-set balances tx-sender (- bal amount))
      (let ((prev-stake (get-staked tx-sender)))
        (map-set staked-balances tx-sender (+ prev-stake amount)))
      (ok true)
    )
  )
)

(define-public (unstake (amount uint))
  (begin
    (ensure-not-paused)
    (let ((stake-bal (get-staked tx-sender)))
      (asserts! (>= stake-bal amount) (err ERR-INSUFFICIENT-STAKE))
      (map-set staked-balances tx-sender (- stake-bal amount))
      (let ((prev-bal (get-balance tx-sender)))
        (map-set balances tx-sender (+ prev-bal amount)))
      (ok true)
    )
  )
)

;; ========== DELEGATION (with inlined cycle check) ==========

(define-public (delegate-vote (to principal))
  (begin
    (ensure-not-paused)
    (asserts! (not (is-eq to tx-sender)) (err ERR-SELF-DELEGATION))

    ;; detect potential cycle by walking chain up to depth cap
    (let loop ((cursor to) (depth u0))
      (begin
        (asserts! (<= depth u10) (err ERR-DELEGATION-CYCLE)) ;; too deep implies cycle-ish
        (if (is-eq cursor tx-sender)
            (err ERR-DELEGATION-CYCLE)
            (let ((next (map-get? delegation cursor)))
              (if (is-none next)
                  ;; no cycle found, proceed to set delegation below
                  (begin
                    (let ((existing (map-get? delegation tx-sender))
                          (power (unwrap-panic (compute-quadratic-power tx-sender))))
                      (if (is-some existing)
                          (let ((prev (unwrap! existing (err ERR-ALREADY-DELEGATED))))
                            (if (is-eq prev to)
                                (err ERR-ALREADY-DELEGATED)
                                (begin
                                  ;; remove previous incoming
                                  (decrease-incoming prev power)
                                  (map-set delegation tx-sender to)
                                  (increase-incoming to power)
                                  (ok true)
                                )
                            )
                          )
                          ;; first time delegation
                          (begin
                            (map-set delegation tx-sender to)
                            (increase-incoming to power)
                            (ok true)
                          )
                      )
                    )
                  )
                  ;; continue walking
                  (let ((next-principal (unwrap! next (err ERR-DELEGATION-CYCLE))))
                    (loop next-principal (+ depth u1))
                  )
              )
            )
        )
      )
    )
  )
)

(define-public (revoke-delegation)
  (begin
    (ensure-not-paused)
    (let ((existing (map-get? delegation tx-sender)))
      (asserts! (is-some existing) (err ERR-NOT-DELEGATED))
      (let ((prev (unwrap! existing (err ERR-NOT-DELEGATED)))
            (power (unwrap-panic (compute-quadratic-power tx-sender))))
        (decrease-incoming prev power)
        (map-delete delegation tx-sender)
        (ok true)
      )
    )
  )
)

;; ========== VOTING POWER CALCULATIONS ==========

(define-read-only (compute-voting-base (account principal))
  (let ((staked (get-staked account))
        (liquid (get-balance account)))
    (ok (+ staked liquid))
  )
)

(define-read-only (compute-quadratic-power (account principal))
  (let ((base (unwrap! (compute-voting-base account) (err ERR-NOT-AUTHORIZED))))
    (let ((sq (sqrt-uint base)))
      (ok sq)
    )
  )
)

(define-read-only (effective-voting-power (account principal))
  (let ((own-base (unwrap! (compute-voting-base account) (err ERR-NOT-AUTHORIZED)))
        (delegated (get-incoming-delegated account)))
    (let ((own-quad (sqrt-uint own-base)))
      (ok (+ own-quad delegated))
    )
  )
)

;; ========== REPUTATION / PARTICIPATION ==========

(define-public (record-vote (proposal-id uint))
  (begin
    (ensure-not-paused)
    (let ((prev (default-to u0 (map-get? proposals-voted tx-sender))))
      (map-set proposals-voted tx-sender (+ prev u1))
    )
    (let ((rep (default-to u0 (map-get? reputation tx-sender))))
      (map-set reputation tx-sender (+ rep u1))
    )
    (ok true)
  )
)

(define-read-only (get-reputation (account principal))
  (ok (default-to u0 (map-get? reputation account)))
)

;; ========== VIEW ACCESSORS ==========

(define-read-only (get-delegatee (account principal))
  (ok (default-to account (map-get? delegation account)))
)

(define-read-only (get-incoming-delegation (account principal))
  (ok (get-incoming-delegated account))
)

(define-read-only (get-admin)
  (ok (var-get admin))
)

(define-read-only (get-total-supply)
  (ok (var-get total-supply))
)

(define-read-only (is-paused)
  (ok (var-get paused))
)
