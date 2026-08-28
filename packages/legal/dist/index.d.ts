/**
 * 法务文档单一事实源：react-native（App 内嵌展示）与 gateway（公网 /legal 页面）共用，
 * 保证两处内容一致 —— App Store 审核会比对产品页链接与 App 内文档。
 * 纯 TS 数据，零 Node/DOM API。
 */
export type LegalDocId = 'privacy' | 'terms' | 'subscription';
export type LegalSection = Readonly<{
    title: string;
    paragraphs: readonly string[];
    bullets?: readonly string[];
}>;
export type LegalDocument = Readonly<{
    /** 路由标识（公网页面 /legal/<id>） */
    id: LegalDocId;
    title: string;
    summary: string;
    effectiveDate: string;
    sections: readonly LegalSection[];
}>;
export declare const privacyPolicy: LegalDocument;
export declare const termsOfService: LegalDocument;
export declare const subscriptionTerms: LegalDocument;
/** 全部法务文档（公网目录页顺序） */
export declare const legalDocuments: readonly LegalDocument[];
/** 按 id 取文档；未知 id 返回 undefined（供路由 404 判断） */
export declare function getLegalDocument(id: string): LegalDocument | undefined;
