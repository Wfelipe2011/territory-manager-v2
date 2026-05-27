import { classifyQuarantineSubcategory } from '../../scripts/reconcileHouseAddresses';

describe('reconcileHouseAddresses - classifyQuarantineSubcategory', () => {
    it('deve classificar como orphan quando não existe territory_block', () => {
        const result = classifyQuarantineSubcategory(false, 0);

        expect(result).toBe('orphan');
    });

    it('deve classificar como tba_missing quando existe territory_block sem TBAs', () => {
        const result = classifyQuarantineSubcategory(true, 0);

        expect(result).toBe('tba_missing');
    });

    it('deve classificar como address_mismatch quando existe territory_block com TBAs', () => {
        const result = classifyQuarantineSubcategory(true, 2);

        expect(result).toBe('address_mismatch');
    });
});
