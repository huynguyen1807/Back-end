/**
 * Multinomial Naive Bayes thuần TypeScript cho bài toán phân loại danh mục thực phẩm.
 *
 * Đây là một mô hình THẬT được huấn luyện bằng thống kê từ dữ liệu (trọng số là tần suất
 * từ/danh mục học được từ corpus huấn luyện, có Laplace smoothing) — khác với lớp rule-based
 * (`foodCategoryValidation.ts`, điểm số do nhóm tự đặt tay) và lớp Gemini (không có trọng số
 * học từ dữ liệu, chỉ prompt engineering). Viết thuần TypeScript, không thêm thư viện ML bên
 * ngoài, để tránh rủi ro tích hợp Python/GPU trong thời gian ngắn và để có thể giải trình
 * chính xác từng bước tính toán khi bảo vệ.
 */
import { normalizeFoodText } from '../utils/foodCategoryValidation';

export type NaiveBayesTrainingDoc = {
  text: string;
  label: string;
};

export type NaiveBayesClassModel = {
  label: string;
  /** Số lượng "văn bản" (tên món/từ khóa/alias) thuộc danh mục này trong tập huấn luyện. */
  docCount: number;
  /** Tổng số token thuộc danh mục này — mẫu số dùng cho Laplace smoothing. */
  totalWords: number;
  /** Tần suất xuất hiện của mỗi token trong danh mục này. */
  wordCounts: Record<string, number>;
};

export type FoodCategoryNaiveBayesModel = {
  version: 1;
  trainedAt: string;
  vocabularySize: number;
  totalDocs: number;
  classes: NaiveBayesClassModel[];
};

const MIN_TOKEN_LENGTH = 2;

/**
 * Trả về cả unigram (từng từ) và bigram (2 từ liền kề, nối bằng "_"). Bigram giúp model phân
 * biệt được NGỮ CẢNH cụm từ — ví dụ "canh chua" (Cooked Food) khác với từ "chua" đứng riêng,
 * và "ca loc" (Fish, một loài cá) khác với "ca" đứng riêng (dễ lẫn vào mọi món có chữ "cá").
 * Đây là điểm yếu đã phát hiện được qua số liệu đánh giá độc lập của model (xem
 * `docs/research/lo-trinh-train-ai-thuc-te.md`), nên bổ sung bigram làm vòng tối ưu thứ 2.
 */
export function tokenize(text: string): string[] {
  const words = normalizeFoodText(text)
    .split(' ')
    .map((token) => token.trim())
    .filter((token) => token.length >= MIN_TOKEN_LENGTH);

  const bigrams: string[] = [];
  for (let i = 0; i < words.length - 1; i += 1) {
    bigrams.push(`${words[i]}_${words[i + 1]}`);
  }

  return [...words, ...bigrams];
}

export function trainNaiveBayes(docs: NaiveBayesTrainingDoc[]): FoodCategoryNaiveBayesModel {
  const byLabel = new Map<string, NaiveBayesClassModel>();
  const vocabulary = new Set<string>();

  for (const doc of docs) {
    const tokens = tokenize(doc.text);
    if (!tokens.length) continue;

    if (!byLabel.has(doc.label)) {
      byLabel.set(doc.label, { label: doc.label, docCount: 0, totalWords: 0, wordCounts: {} });
    }
    const classModel = byLabel.get(doc.label)!;
    classModel.docCount += 1;

    for (const token of tokens) {
      vocabulary.add(token);
      classModel.totalWords += 1;
      classModel.wordCounts[token] = (classModel.wordCounts[token] ?? 0) + 1;
    }
  }

  return {
    version: 1,
    trainedAt: new Date().toISOString(),
    vocabularySize: vocabulary.size,
    totalDocs: docs.length,
    classes: Array.from(byLabel.values()),
  };
}

export type NaiveBayesPrediction = {
  categoryName: string;
  /** Xác suất hậu nghiệm (softmax trên log-likelihood) của danh mục được chọn, 0..1. */
  probability: number;
  runnerUp?: { categoryName: string; probability: number };
};

export function predictWithModel(model: FoodCategoryNaiveBayesModel, text: string): NaiveBayesPrediction | null {
  const tokens = tokenize(text);
  if (!tokens.length || !model.classes.length) return null;

  const totalDocs = model.totalDocs || model.classes.reduce((sum, c) => sum + c.docCount, 0);
  const vocabularySize = model.vocabularySize || 1;

  const scored = model.classes.map((classModel) => {
    const logPrior = Math.log((classModel.docCount || 1) / (totalDocs || 1));
    let logLikelihood = 0;
    for (const token of tokens) {
      const count = classModel.wordCounts[token] ?? 0;
      logLikelihood += Math.log((count + 1) / (classModel.totalWords + vocabularySize));
    }
    return { categoryName: classModel.label, score: logPrior + logLikelihood };
  });

  scored.sort((a, b) => b.score - a.score);

  // softmax trên log-score để ra xác suất có thể so sánh (đã trừ max để tránh overflow).
  const maxScore = scored[0].score;
  const expScores = scored.map((item) => Math.exp(item.score - maxScore));
  const sumExp = expScores.reduce((sum, value) => sum + value, 0);

  const best = scored[0];
  const bestProbability = expScores[0] / sumExp;

  const result: NaiveBayesPrediction = {
    categoryName: best.categoryName,
    probability: bestProbability,
  };

  if (scored.length > 1) {
    result.runnerUp = {
      categoryName: scored[1].categoryName,
      probability: expScores[1] / sumExp,
    };
  }

  return result;
}
