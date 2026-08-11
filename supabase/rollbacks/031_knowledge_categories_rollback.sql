-- Rollback for 031_knowledge_categories.sql
--
-- faqs.category is plain text and is NOT dropped — existing FAQ rows keep
-- whatever category name they carry, so no knowledge is lost by rolling back.
DROP TABLE IF EXISTS knowledge_categories;
