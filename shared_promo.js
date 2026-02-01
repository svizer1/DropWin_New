import { doc, getDoc, updateDoc, setDoc, deleteDoc, runTransaction, arrayUnion, increment, collection, query, orderBy, limit, getDocs } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";

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

export async function deletePromoCode(db, code) {
    await deleteDoc(doc(db, 'promocodes', code));
    return true;
}

export async function getRecentPromos(db) {
    const q = query(collection(db, 'promocodes'), orderBy('createdAt', 'desc'), limit(20));
    const snap = await getDocs(q);
    return snap.docs.map(d => d.data());
}

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
                throw new Error('Активации этого промокода закончились');
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
        const userSnap = await transaction.get(userRef);
        const userData = userSnap.data() || {};
        
        const GLOBAL_PROMOS = {
            'PROMOCODE_DAY_670': { val: 50, type: 'money' },
            'WELCOME': { val: 100, type: 'money' },
            'DROPWIN2026': { val: 200, type: 'money' },
            'KAVEXS': { val: 1000, type: 'money' },
            'KAVEXS2026': { val: 5000, type: 'money' }
        };
        
        if (GLOBAL_PROMOS[code]) {
            const reward = GLOBAL_PROMOS[code];
            const used = userData.usedPromos || [];
            
            if (used.includes(code)) {
                throw new Error('Вы уже использовали этот промокод');
            }
            
            const newBalance = (userData.balance || 0) + reward.val;
            transaction.update(userRef, {
                balance: newBalance,
                usedPromos: arrayUnion(code)
            });
            
            return { success: true, value: reward.val, type: reward.type, message: `Промокод активирован: +${reward.val}₽` };
        }

        // 3. Check Personal Active Promo
        if (userData.activePromoCode === code && !userData.activePromoUsed) {
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
                 return { success: false, redirect: 'dep.html', message: 'Это бонус к депозиту. Переходим на пополнение...' };
             }
        }

        throw new Error('Неверный промокод');
    });
}
