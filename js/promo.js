
import { doc, getDoc, updateDoc, setDoc, runTransaction, arrayUnion, increment } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

// Admin: Create Promo
export async function createPromoCode(db, code, activations, value, type = 'money') {
    const promoRef = doc(db, 'promocodes', code);
    await setDoc(promoRef, {
        code: code,
        activationsLeft: Number(activations),
        value: Number(value),
        type: type, // 'money' or 'dep'
        usersUsed: [],
        createdAt: Date.now()
    });
    return true;
}

// User: Redeem Promo
export async function redeemPromoCode(db, userId, codeInput) {
    if (!userId) throw new Error('Сначала войдите в аккаунт');
    
    const code = codeInput.trim();
    const promoRef = doc(db, 'promocodes', code);
    const userRef = doc(db, 'users', userId);

    return await runTransaction(db, async (transaction) => {
        const promoSnap = await transaction.get(promoRef);
        
        // 1. Check Firestore Promos
        if (promoSnap.exists()) {
            const promoData = promoSnap.data();
            
            if (promoData.activationsLeft <= 0) {
                throw new Error('Промокод закончился (0 активаций)');
            }
            
            if (promoData.usersUsed && promoData.usersUsed.includes(userId)) {
                throw new Error('Вы уже использовали этот промокод');
            }

            // Apply Reward
            if (promoData.type === 'money') {
                const userSnap = await transaction.get(userRef);
                const userData = userSnap.data() || {};
                const newBalance = (userData.balance || 0) + promoData.value;
                
                transaction.update(userRef, {
                    balance: newBalance
                });
            } else if (promoData.type === 'dep' || promoData.type.startsWith('dep')) {
                // Deposit bonus
                transaction.update(userRef, {
                    activePromoCode: code,
                    activePromoType: promoData.type,
                    activePromoValue: promoData.value,
                    activePromoUsed: false
                });
            }

            // Update Promo Stats
            transaction.update(promoRef, {
                activationsLeft: increment(-1),
                usersUsed: arrayUnion(userId)
            });
            
            return { success: true, value: promoData.value, type: promoData.type, message: `Промокод активирован: +${promoData.value}${promoData.type === 'money' ? '₽' : '% к депу'}` };
        } 
        
        // 2. Check Global/Legacy Hardcoded Promos (Fallback)
        // We can't use transaction for hardcoded checks easily without reading user doc first.
        // So we do it outside or assume if not in Firestore, we check hardcoded.
        // But to be safe, we return null here and let the caller handle legacy if they want, 
        // OR we handle it here by reading user doc.
        
        const userSnap = await transaction.get(userRef);
        const userData = userSnap.data() || {};
        
        // Hardcoded List (Moved from index.html)
        const GLOBAL_PROMOS = {
            'PROMOCODE_DAY_670': { val: 50, type: 'money' },
            'WELCOME': { val: 100, type: 'money' },
            'DROPWIN2026': { val: 200, type: 'money' }
        };
        
        if (GLOBAL_PROMOS[code]) {
            const reward = GLOBAL_PROMOS[code];
            const used = userData.usedPromos || [];
            
            if (used.includes(code)) {
                throw new Error('Вы уже использовали этот промокод');
            }
            
            // Apply
            const newBalance = (userData.balance || 0) + reward.val;
            transaction.update(userRef, {
                balance: newBalance,
                usedPromos: arrayUnion(code)
            });
            
            return { success: true, value: reward.val, type: reward.type, message: `Промокод активирован: +${reward.val}₽` };
        }

        // 3. Check Personal Active Promo (from FreeBet/Daily)
        if (userData.activePromoCode === code && !userData.activePromoUsed) {
             // This is usually for DEPOSIT, but if it's a money code:
             if (userData.activePromoType && userData.activePromoType.startsWith('bonus')) {
                 const val = userData.activePromoValue || 0;
                 transaction.update(userRef, {
                     balance: (userData.balance || 0) + val,
                     activePromoCode: null,
                     activePromoValue: 0,
                     activePromoUsed: true
                 });
                 return { success: true, value: val, type: 'money', message: `Бонус активирован: +${val}₽` };
             } else {
                 // It's a deposit bonus, guide user to deposit
                 return { success: false, redirect: 'dep.html', message: 'Это бонус к депозиту. Переходим на пополнение...' };
             }
        }

        throw new Error('Неверный промокод');
    });
}
